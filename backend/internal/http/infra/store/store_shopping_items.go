package store

import (
	"context"
	"errors"
	"slices"
	"strings"

	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (s *Store) ListShoppingItems(ctx context.Context, userID string) ([]api.ShoppingListItem, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListShoppingItemsByTeamID(ctx, teamID)
	if err != nil {
		return nil, err
	}
	items := make([]api.ShoppingListItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, shoppingItemFromDB(row, s.loc).toAPI())
	}
	return items, nil
}

func (s *Store) CreateShoppingItem(ctx context.Context, userID string, req api.CreateShoppingListItemRequest) (api.ShoppingListItem, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.ShoppingListItem{}, err
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return api.ShoppingListItem{}, errors.New("name is required")
	}
	now := s.now()
	item := shoppingItemRecord{
		ID:        s.nextID("shop"),
		TeamID:    teamID,
		Name:      name,
		Quantity:  normalizeOptionalString(req.Quantity),
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
			maxPosition, err := qtx.GetShoppingItemMaxPositionByTeamID(txCtx, teamID)
			if err != nil {
				return err
			}
			item.Position = int(maxPosition) + 1
			position32, err := safeInt32(item.Position, "position")
			if err != nil {
				return err
			}
			return qtx.CreateShoppingItem(txCtx, dbsqlc.CreateShoppingItemParams{
				ID:        item.ID,
				TeamID:    item.TeamID,
				Name:      item.Name,
				Quantity:  textFromPtr(item.Quantity),
				Notes:     textFromPtr(item.Notes),
				Position:  position32,
				CreatedAt: toPgTimestamptz(item.CreatedAt),
				UpdatedAt: toPgTimestamptz(item.UpdatedAt),
			})
		},
	); err != nil {
		return api.ShoppingListItem{}, err
	}
	return item.toAPI(), nil
}

func (s *Store) PatchShoppingItem(ctx context.Context, userID, itemID string, req api.UpdateShoppingListItemRequest) (api.ShoppingListItem, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.ShoppingListItem{}, err
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
				name := strings.TrimSpace(*req.Name)
				if name == "" {
					return errors.New("name cannot be empty")
				}
				item.Name = name
			}
			if req.Quantity != nil {
				item.Quantity = normalizeOptionalString(req.Quantity)
			}
			if req.Notes != nil {
				item.Notes = normalizeOptionalString(req.Notes)
			}
			item.UpdatedAt = s.now()
			return qtx.UpdateShoppingItem(txCtx, dbsqlc.UpdateShoppingItemParams{
				ID:        item.ID,
				Name:      item.Name,
				Quantity:  textFromPtr(item.Quantity),
				Notes:     textFromPtr(item.Notes),
				UpdatedAt: toPgTimestamptz(item.UpdatedAt),
			})
		},
	); err != nil {
		return api.ShoppingListItem{}, err
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
			position32, err := safeInt32(item.Position, "position")
			if err != nil {
				return err
			}
			return qtx.CompactShoppingItemPositionsAfter(txCtx, dbsqlc.CompactShoppingItemPositionsAfterParams{
				TeamID:    teamID,
				Position:  position32,
				UpdatedAt: toPgTimestamptz(s.now()),
			})
		},
	)
	return err
}

func (s *Store) ReorderShoppingItems(ctx context.Context, userID string, req api.ReorderShoppingListItemsRequest) ([]api.ShoppingListItem, error) {
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

	items := make([]api.ShoppingListItem, 0, len(req.ItemIds))
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
			slices.Sort(currentIDs)
			requestedIDs := append([]string(nil), req.ItemIds...)
			slices.Sort(requestedIDs)
			if !slices.Equal(currentIDs, requestedIDs) {
				return errors.New("itemIds must match current shopping items")
			}

			now := s.now()
			offsetBase := len(req.ItemIds) + 1
			for index, itemID := range req.ItemIds {
				tempPosition, convErr := safeInt32(offsetBase+index, "position")
				if convErr != nil {
					return convErr
				}
				if err := qtx.UpdateShoppingItemPosition(txCtx, dbsqlc.UpdateShoppingItemPositionParams{
					ID:        itemID,
					Position:  tempPosition,
					UpdatedAt: toPgTimestamptz(now),
				}); err != nil {
					return err
				}
			}
			for index, itemID := range req.ItemIds {
				finalPosition, convErr := safeInt32(index+1, "position")
				if convErr != nil {
					return convErr
				}
				if err := qtx.UpdateShoppingItemPosition(txCtx, dbsqlc.UpdateShoppingItemPositionParams{
					ID:        itemID,
					Position:  finalPosition,
					UpdatedAt: toPgTimestamptz(now),
				}); err != nil {
					return err
				}
				item := itemsByID[itemID]
				item.Position = index + 1
				item.UpdatedAt = now
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
