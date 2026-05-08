package repositories

import (
	"context"

	model "github.com/megu/kaji-challenge/backend/internal/http/application/model"
)

func (r shoppingListRepo) ListShoppingItems(ctx context.Context, userID string) ([]model.ShoppingListItem, error) {
	items, err := r.store.ListShoppingItems(ctx, userID)
	return items, mapInfraErr(err)
}

func (r shoppingListRepo) CreateShoppingItem(ctx context.Context, userID string, req model.CreateShoppingListItemRequest) (model.ShoppingListItem, error) {
	item, err := r.store.CreateShoppingItem(ctx, userID, req)
	return item, mapInfraErr(err)
}

func (r shoppingListRepo) PatchShoppingItem(ctx context.Context, userID, itemID string, req model.UpdateShoppingListItemRequest) (model.ShoppingListItem, error) {
	item, err := r.store.PatchShoppingItem(ctx, userID, itemID, req)
	return item, mapInfraErr(err)
}

func (r shoppingListRepo) DeleteShoppingItem(ctx context.Context, userID, itemID string) error {
	return mapInfraErr(r.store.DeleteShoppingItem(ctx, userID, itemID))
}

func (r shoppingListRepo) ReorderShoppingItems(ctx context.Context, userID string, req model.ReorderShoppingListItemsRequest) ([]model.ShoppingListItem, error) {
	items, err := r.store.ReorderShoppingItems(ctx, userID, req)
	return items, mapInfraErr(err)
}
