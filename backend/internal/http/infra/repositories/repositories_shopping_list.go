package repositories

import (
	"context"

	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (r shoppingListRepo) ListShoppingItems(ctx context.Context, userID string) ([]api.ShoppingListItem, error) {
	items, err := r.store.ListShoppingItems(ctx, userID)
	return items, mapInfraErr(err)
}

func (r shoppingListRepo) CreateShoppingItem(ctx context.Context, userID string, req api.CreateShoppingListItemRequest) (api.ShoppingListItem, error) {
	item, err := r.store.CreateShoppingItem(ctx, userID, req)
	return item, mapInfraErr(err)
}

func (r shoppingListRepo) PatchShoppingItem(ctx context.Context, userID, itemID string, req api.UpdateShoppingListItemRequest) (api.ShoppingListItem, error) {
	item, err := r.store.PatchShoppingItem(ctx, userID, itemID, req)
	return item, mapInfraErr(err)
}

func (r shoppingListRepo) DeleteShoppingItem(ctx context.Context, userID, itemID string) error {
	return mapInfraErr(r.store.DeleteShoppingItem(ctx, userID, itemID))
}

func (r shoppingListRepo) ReorderShoppingItems(ctx context.Context, userID string, req api.ReorderShoppingListItemsRequest) ([]api.ShoppingListItem, error) {
	items, err := r.store.ReorderShoppingItems(ctx, userID, req)
	return items, mapInfraErr(err)
}
