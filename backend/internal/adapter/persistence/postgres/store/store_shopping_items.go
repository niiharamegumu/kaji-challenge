package store

import (
	"context"
	"errors"
	"slices"
	"strings"

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	domainshopping "github.com/megu/kaji-challenge/backend/internal/domain/shopping"
	"github.com/megu/kaji-challenge/backend/internal/domain/sortkey"
)

func (s *Store) ListShoppingItems(ctx context.Context, userID string) ([]model.ShoppingListItem, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListShoppingItemsByTeamID(ctx, teamID)
	if err != nil {
		return nil, err
	}
	items := make([]model.ShoppingListItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, shoppingItemFromDB(row, s.loc).toAPI())
	}
	return items, nil
}

func (s *Store) CreateShoppingItem(ctx context.Context, userID string, req model.CreateShoppingListItemRequest) (model.ShoppingListItem, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return model.ShoppingListItem{}, err
	}
	name, err := domainshopping.NormalizeItemName(req.Name)
	if err != nil {
		return model.ShoppingListItem{}, err
	}
	now := s.now()
	item := shoppingItemRecord{
		ID:        s.nextID("shop"),
		TeamID:    teamID,
		Name:      name,
		Notes:     normalizeOptionalString(req.Notes),
		CreatedAt: now,
		UpdatedAt: now,
	}

	if _, err := s.runWithTeamRevisionCAS(
		ctx,
		teamID,
		"shopping_item",
		map[string]string{"itemId": item.ID, "action": "create"},
		func(txCtx context.Context, qtx *dbsqlc.Queries) error {
			rows, err := qtx.ListShoppingItemsByTeamID(txCtx, teamID)
			if err != nil {
				return err
			}
			var firstSortKey int32
			if len(rows) > 0 {
				firstSortKey = rows[0].SortKey
			}
			sortKey32, hasGap := sortkey.Prepend(firstSortKey)
			if !hasGap {
				for index, row := range rows {
					sortKey, err := sortkey.ForIndex(index + 1)
					if err != nil {
						return err
					}
					if err := qtx.UpdateShoppingItemSortKey(txCtx, dbsqlc.UpdateShoppingItemSortKeyParams{
						ID:        row.ID,
						SortKey:   sortKey,
						UpdatedAt: toPgTimestamptz(now),
					}); err != nil {
						return err
					}
				}
			}
			item.SortKey = int(sortKey32)
			return qtx.CreateShoppingItem(txCtx, dbsqlc.CreateShoppingItemParams{
				ID:        item.ID,
				TeamID:    item.TeamID,
				Name:      item.Name,
				Notes:     textFromPtr(item.Notes),
				SortKey:   sortKey32,
				CreatedAt: toPgTimestamptz(item.CreatedAt),
				UpdatedAt: toPgTimestamptz(item.UpdatedAt),
			})
		},
	); err != nil {
		return model.ShoppingListItem{}, err
	}
	return item.toAPI(), nil
}

func (s *Store) PatchShoppingItem(ctx context.Context, userID, itemID string, req model.UpdateShoppingListItemRequest) (model.ShoppingListItem, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return model.ShoppingListItem{}, err
	}
	var item shoppingItemRecord
	if _, err := s.runWithTeamRevisionCAS(
		ctx,
		teamID,
		"shopping_item",
		map[string]string{"itemId": itemID, "action": "update"},
		func(txCtx context.Context, qtx *dbsqlc.Queries) error {
			row, err := qtx.GetShoppingItemByID(txCtx, itemID)
			if err != nil {
				return errors.New("shopping item not found")
			}
			item = shoppingItemFromDB(row, s.loc)
			if item.TeamID != teamID {
				return errors.New("shopping item not found")
			}
			if req.Name != nil {
				name, err := domainshopping.NormalizePatchItemName(*req.Name)
				if err != nil {
					return err
				}
				item.Name = name
			}
			if req.Notes != nil {
				item.Notes = normalizeOptionalString(req.Notes)
			}
			item.UpdatedAt = s.now()
			return qtx.UpdateShoppingItem(txCtx, dbsqlc.UpdateShoppingItemParams{
				ID:        item.ID,
				Name:      item.Name,
				Notes:     textFromPtr(item.Notes),
				UpdatedAt: toPgTimestamptz(item.UpdatedAt),
			})
		},
	); err != nil {
		return model.ShoppingListItem{}, err
	}
	return item.toAPI(), nil
}

func (s *Store) DeleteShoppingItem(ctx context.Context, userID, itemID string) error {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return err
	}
	_, err = s.runWithTeamRevisionCAS(
		ctx,
		teamID,
		"shopping_item",
		map[string]string{"itemId": itemID, "action": "delete"},
		func(txCtx context.Context, qtx *dbsqlc.Queries) error {
			row, err := qtx.GetShoppingItemByID(txCtx, itemID)
			if err != nil {
				return errors.New("shopping item not found")
			}
			item := shoppingItemFromDB(row, s.loc)
			if item.TeamID != teamID {
				return errors.New("shopping item not found")
			}
			deleted, err := qtx.DeleteShoppingItem(txCtx, itemID)
			if err != nil {
				return err
			}
			if deleted != 1 {
				return errors.New("shopping item not found")
			}
			return nil
		},
	)
	return err
}

func (s *Store) ReorderShoppingItems(ctx context.Context, userID string, req model.ReorderShoppingListItemsRequest) ([]model.ShoppingListItem, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(req.ItemIds) == 0 {
		return nil, errors.New("itemIds is required")
	}
	seen := make(map[string]struct{}, len(req.ItemIds))
	for _, itemID := range req.ItemIds {
		if strings.TrimSpace(itemID) == "" {
			return nil, errors.New("itemIds contains empty id")
		}
		if _, exists := seen[itemID]; exists {
			return nil, errors.New("itemIds contains duplicate id")
		}
		seen[itemID] = struct{}{}
	}

	items := make([]model.ShoppingListItem, 0, len(req.ItemIds))
	if _, err := s.runWithTeamRevisionCAS(
		ctx,
		teamID,
		"shopping_item",
		map[string]string{"action": "reorder"},
		func(txCtx context.Context, qtx *dbsqlc.Queries) error {
			rows, err := qtx.ListShoppingItemsByTeamID(txCtx, teamID)
			if err != nil {
				return err
			}
			if len(rows) != len(req.ItemIds) {
				return errors.New("itemIds must include every shopping item in the team")
			}
			currentIDs := make([]string, 0, len(rows))
			itemsByID := make(map[string]shoppingItemRecord, len(rows))
			for _, row := range rows {
				item := shoppingItemFromDB(row, s.loc)
				currentIDs = append(currentIDs, item.ID)
				itemsByID[item.ID] = item
			}
			currentIDsSorted := append([]string(nil), currentIDs...)
			slices.Sort(currentIDsSorted)
			requestedIDs := append([]string(nil), req.ItemIds...)
			slices.Sort(requestedIDs)
			if !slices.Equal(currentIDsSorted, requestedIDs) {
				return errors.New("itemIds must match current shopping items")
			}

			now := s.now()
			movedItemID := sortkey.FindMovedID(currentIDs, req.ItemIds)
			currentSortKeys := make(map[string]int32, len(rows))
			for _, row := range rows {
				currentSortKeys[row.ID] = row.SortKey
			}

			if movedItemID != "" {
				nextSortKey, ok, err := sortkey.MovedItemSortKey(req.ItemIds, currentSortKeys, movedItemID)
				if err != nil {
					return err
				}
				if ok {
					if err := qtx.UpdateShoppingItemSortKey(txCtx, dbsqlc.UpdateShoppingItemSortKeyParams{
						ID:        movedItemID,
						SortKey:   nextSortKey,
						UpdatedAt: toPgTimestamptz(now),
					}); err != nil {
						return err
					}
					item := itemsByID[movedItemID]
					item.SortKey = int(nextSortKey)
					item.UpdatedAt = now
					itemsByID[movedItemID] = item
				} else {
					for index, itemID := range req.ItemIds {
						sortKey, err := sortkey.ForIndex(index)
						if err != nil {
							return err
						}
						if err := qtx.UpdateShoppingItemSortKey(txCtx, dbsqlc.UpdateShoppingItemSortKeyParams{
							ID:        itemID,
							SortKey:   sortKey,
							UpdatedAt: toPgTimestamptz(now),
						}); err != nil {
							return err
						}
						item := itemsByID[itemID]
						item.SortKey = int(sortKey)
						item.UpdatedAt = now
						itemsByID[itemID] = item
					}
				}
			} else {
				for index, itemID := range req.ItemIds {
					sortKey, err := sortkey.ForIndex(index)
					if err != nil {
						return err
					}
					if err := qtx.UpdateShoppingItemSortKey(txCtx, dbsqlc.UpdateShoppingItemSortKeyParams{
						ID:        itemID,
						SortKey:   sortKey,
						UpdatedAt: toPgTimestamptz(now),
					}); err != nil {
						return err
					}
					item := itemsByID[itemID]
					item.SortKey = int(sortKey)
					item.UpdatedAt = now
					itemsByID[itemID] = item
				}
			}

			for _, itemID := range req.ItemIds {
				item := itemsByID[itemID]
				items = append(items, item.toAPI())
			}
			return nil
		},
	); err != nil {
		return nil, err
	}
	return items, nil
}

func normalizeOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	normalized := trimmed
	return &normalized
}
