package store

import (
	"context"
	"testing"
	"time"

	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func TestShoppingItemsFollowTeamScopeAndOrdering(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	base := time.Date(2026, 3, 1, 9, 0, 0, 0, s.loc)

	_, userA := createTeamWithMember(t, s, "shopping-a@example.com", base)
	teamB, _ := createTeamWithMember(t, s, "shopping-b@example.com", base.Add(time.Hour))

	itemA1 := createShoppingItemAt(t, s, userA, "牛乳", stringPtr("1本"), nil, base)
	itemA2 := createShoppingItemAt(t, s, userA, "卵", stringPtr("10個"), nil, base.Add(time.Minute))
	createShoppingItemForTeamAt(t, s, teamB, "パン", nil, nil, base.Add(2*time.Minute))

	items, err := s.ListShoppingItems(ctx, userA)
	if err != nil {
		t.Fatalf("ListShoppingItems failed: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(items))
	}
	if items[0].Id != itemA1 || items[1].Id != itemA2 {
		t.Fatalf("unexpected item order: %#v", items)
	}
}

func TestCreateShoppingItemAppendsToEnd(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	base := time.Date(2026, 3, 1, 9, 0, 0, 0, s.loc)
	_, userID := createTeamWithMember(t, s, "shopping-create@example.com", base)

	createShoppingItemAt(t, s, userID, "牛乳", nil, nil, base)
	item, err := s.CreateShoppingItem(withLatestIfMatchForUser(t, s, ctx, userID), userID, api.CreateShoppingListItemRequest{
		Name:     "卵",
		Quantity: stringPtr("10個"),
	})
	if err != nil {
		t.Fatalf("CreateShoppingItem failed: %v", err)
	}
	if item.Position != 2 {
		t.Fatalf("expected appended position 2, got %d", item.Position)
	}
	if item.Quantity == nil || *item.Quantity != "10個" {
		t.Fatalf("expected quantity to be preserved, got %#v", item.Quantity)
	}
}

func TestPatchShoppingItemUpdatesFields(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	base := time.Date(2026, 3, 1, 9, 0, 0, 0, s.loc)
	_, userID := createTeamWithMember(t, s, "shopping-patch@example.com", base)
	itemID := createShoppingItemAt(t, s, userID, "牛乳", stringPtr("1本"), nil, base)

	updated, err := s.PatchShoppingItem(withLatestIfMatchForUser(t, s, ctx, userID), userID, itemID, api.UpdateShoppingListItemRequest{
		Name:     stringPtr("低脂肪乳"),
		Quantity: stringPtr("2本"),
		Notes:    stringPtr("週末特売"),
	})
	if err != nil {
		t.Fatalf("PatchShoppingItem failed: %v", err)
	}
	if updated.Name != "低脂肪乳" {
		t.Fatalf("expected updated name, got %s", updated.Name)
	}
	if updated.Quantity == nil || *updated.Quantity != "2本" {
		t.Fatalf("expected updated quantity, got %#v", updated.Quantity)
	}
	if updated.Notes == nil || *updated.Notes != "週末特売" {
		t.Fatalf("expected updated notes, got %#v", updated.Notes)
	}
}

func TestDeleteShoppingItemPhysicallyRemovesAndCompactsPositions(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	base := time.Date(2026, 3, 1, 9, 0, 0, 0, s.loc)
	_, userID := createTeamWithMember(t, s, "shopping-delete@example.com", base)

	firstID := createShoppingItemAt(t, s, userID, "牛乳", nil, nil, base)
	secondID := createShoppingItemAt(t, s, userID, "卵", nil, nil, base.Add(time.Minute))
	thirdID := createShoppingItemAt(t, s, userID, "パン", nil, nil, base.Add(2*time.Minute))

	if err := s.DeleteShoppingItem(withLatestIfMatchForUser(t, s, ctx, userID), userID, secondID); err != nil {
		t.Fatalf("DeleteShoppingItem failed: %v", err)
	}

	if _, err := s.q.GetShoppingItemByID(ctx, secondID); err == nil {
		t.Fatalf("expected deleted item to be absent")
	}
	items, err := s.ListShoppingItems(ctx, userID)
	if err != nil {
		t.Fatalf("ListShoppingItems failed: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 remaining items, got %d", len(items))
	}
	if items[0].Id != firstID || items[0].Position != 1 {
		t.Fatalf("unexpected first item after delete: %#v", items[0])
	}
	if items[1].Id != thirdID || items[1].Position != 2 {
		t.Fatalf("unexpected second item after delete: %#v", items[1])
	}
}

func TestReorderShoppingItemsPersistsRequestedOrder(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	base := time.Date(2026, 3, 1, 9, 0, 0, 0, s.loc)
	_, userID := createTeamWithMember(t, s, "shopping-reorder@example.com", base)

	firstID := createShoppingItemAt(t, s, userID, "牛乳", nil, nil, base)
	secondID := createShoppingItemAt(t, s, userID, "卵", nil, nil, base.Add(time.Minute))
	thirdID := createShoppingItemAt(t, s, userID, "パン", nil, nil, base.Add(2*time.Minute))

	items, err := s.ReorderShoppingItems(withLatestIfMatchForUser(t, s, ctx, userID), userID, api.ReorderShoppingListItemsRequest{
		ItemIds: []string{thirdID, firstID, secondID},
	})
	if err != nil {
		t.Fatalf("ReorderShoppingItems failed: %v", err)
	}
	if len(items) != 3 {
		t.Fatalf("expected 3 reordered items, got %d", len(items))
	}
	if items[0].Id != thirdID || items[0].Position != 1 {
		t.Fatalf("unexpected first reordered item: %#v", items[0])
	}
	if items[1].Id != firstID || items[2].Id != secondID {
		t.Fatalf("unexpected reordered sequence: %#v", items)
	}
}

func TestReorderShoppingItemsRejectsMismatchedIDs(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	base := time.Date(2026, 3, 1, 9, 0, 0, 0, s.loc)
	_, userID := createTeamWithMember(t, s, "shopping-reorder-invalid@example.com", base)

	createShoppingItemAt(t, s, userID, "牛乳", nil, nil, base)
	createShoppingItemAt(t, s, userID, "卵", nil, nil, base.Add(time.Minute))

	if _, err := s.ReorderShoppingItems(withLatestIfMatchForUser(t, s, ctx, userID), userID, api.ReorderShoppingListItemsRequest{
		ItemIds: []string{"missing-id"},
	}); err == nil {
		t.Fatalf("expected ReorderShoppingItems to reject mismatched ids")
	}
}

func TestReorderShoppingItemsRejectsDuplicateIDs(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	base := time.Date(2026, 3, 1, 9, 0, 0, 0, s.loc)
	_, userID := createTeamWithMember(t, s, "shopping-reorder-duplicate@example.com", base)

	firstID := createShoppingItemAt(t, s, userID, "牛乳", nil, nil, base)
	createShoppingItemAt(t, s, userID, "卵", nil, nil, base.Add(time.Minute))

	if _, err := s.ReorderShoppingItems(withLatestIfMatchForUser(t, s, ctx, userID), userID, api.ReorderShoppingListItemsRequest{
		ItemIds: []string{firstID, firstID},
	}); err == nil {
		t.Fatalf("expected ReorderShoppingItems to reject duplicate ids")
	}
}

func TestReorderShoppingItemsRejectsOtherTeamIDs(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	base := time.Date(2026, 3, 1, 9, 0, 0, 0, s.loc)
	_, userID := createTeamWithMember(t, s, "shopping-reorder-team-a@example.com", base)
	teamB, _ := createTeamWithMember(t, s, "shopping-reorder-team-b@example.com", base.Add(time.Hour))

	firstID := createShoppingItemAt(t, s, userID, "牛乳", nil, nil, base)
	createShoppingItemAt(t, s, userID, "卵", nil, nil, base.Add(time.Minute))
	foreignID := createShoppingItemForTeamAt(t, s, teamB, "パン", nil, nil, base.Add(2*time.Minute))

	if _, err := s.ReorderShoppingItems(withLatestIfMatchForUser(t, s, ctx, userID), userID, api.ReorderShoppingListItemsRequest{
		ItemIds: []string{firstID, foreignID},
	}); err == nil {
		t.Fatalf("expected ReorderShoppingItems to reject ids from another team")
	}
}

func TestCreateShoppingItemRequiresLatestETag(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	base := time.Date(2026, 3, 1, 9, 0, 0, 0, s.loc)
	_, userID := createTeamWithMember(t, s, "shopping-precondition@example.com", base)

	if _, err := s.CreateShoppingItem(ctx, userID, api.CreateShoppingListItemRequest{Name: "牛乳"}); err == nil {
		t.Fatalf("expected precondition failure without If-Match")
	}
}

func TestShoppingItemsForeignKeyCascadeAndUniquePosition(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	base := time.Date(2026, 3, 1, 9, 0, 0, 0, s.loc)
	teamID, userID := createTeamWithMember(t, s, "shopping-schema@example.com", base)

	itemID := createShoppingItemAt(t, s, userID, "牛乳", nil, nil, base)
	if err := s.q.CreateShoppingItem(ctx, dbsqlc.CreateShoppingItemParams{
		ID:        s.nextID("shop"),
		TeamID:    teamID,
		Name:      "重複順序",
		Quantity:  textFromPtr(nil),
		Notes:     textFromPtr(nil),
		Position:  1,
		CreatedAt: toPgTimestamptz(base.Add(time.Minute)),
		UpdatedAt: toPgTimestamptz(base.Add(time.Minute)),
	}); err == nil {
		t.Fatalf("expected unique(team_id, position) violation")
	}

	if _, err := s.db.Exec(ctx, `DELETE FROM teams WHERE id = $1`, teamID); err != nil {
		t.Fatalf("failed to delete team: %v", err)
	}
	if _, err := s.q.GetShoppingItemByID(ctx, itemID); err == nil {
		t.Fatalf("expected shopping item to be removed by team cascade")
	}
}

func createShoppingItemAt(t *testing.T, s *Store, userID, name string, quantity, notes *string, createdAt time.Time) string {
	t.Helper()
	teamID, err := s.primaryTeamLocked(context.Background(), userID)
	if err != nil {
		t.Fatalf("failed to load team: %v", err)
	}
	return createShoppingItemForTeamAt(t, s, teamID, name, quantity, notes, createdAt)
}

func createShoppingItemForTeamAt(t *testing.T, s *Store, teamID, name string, quantity, notes *string, createdAt time.Time) string {
	t.Helper()
	maxPosition, err := s.q.GetShoppingItemMaxPositionByTeamID(context.Background(), teamID)
	if err != nil {
		t.Fatalf("failed to load max position: %v", err)
	}
	itemID := s.nextID("shop")
	if err := s.q.CreateShoppingItem(context.Background(), dbsqlc.CreateShoppingItemParams{
		ID:        itemID,
		TeamID:    teamID,
		Name:      name,
		Quantity:  textFromPtr(quantity),
		Notes:     textFromPtr(notes),
		Position:  maxPosition + 1,
		CreatedAt: toPgTimestamptz(createdAt),
		UpdatedAt: toPgTimestamptz(createdAt),
	}); err != nil {
		t.Fatalf("failed to create shopping item: %v", err)
	}
	return itemID
}

func stringPtr(value string) *string {
	v := value
	return &v
}
