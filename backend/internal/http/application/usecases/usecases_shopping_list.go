package usecases

import (
	"context"

	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (u shoppingListUsecase) ListShoppingItems(ctx context.Context, userID string) ([]api.ShoppingListItem, error) {
	return u.repo.ListShoppingItems(ctx, userID)
}

func (u shoppingListUsecase) CreateShoppingItem(ctx context.Context, userID string, req api.CreateShoppingListItemRequest) (api.ShoppingListItem, error) {
	return u.repo.CreateShoppingItem(ctx, userID, req)
}

func (u shoppingListUsecase) PatchShoppingItem(ctx context.Context, userID, itemID string, req api.UpdateShoppingListItemRequest) (api.ShoppingListItem, error) {
	return u.repo.PatchShoppingItem(ctx, userID, itemID, req)
}

func (u shoppingListUsecase) DeleteShoppingItem(ctx context.Context, userID, itemID string) error {
	return u.repo.DeleteShoppingItem(ctx, userID, itemID)
}

func (u shoppingListUsecase) ReorderShoppingItems(ctx context.Context, userID string, req api.ReorderShoppingListItemsRequest) ([]api.ShoppingListItem, error) {
	return u.repo.ReorderShoppingItems(ctx, userID, req)
}
