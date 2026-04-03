package repositories

import (
	"context"

	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (r pushRepo) UpsertPushSubscription(ctx context.Context, userID string, req api.UpsertPushSubscriptionRequest) (api.PushSubscription, error) {
	res, err := r.store.UpsertPushSubscription(ctx, userID, req)
	return res, mapInfraErr(err)
}

func (r pushRepo) DeletePushSubscription(ctx context.Context, userID, subscriptionID string) error {
	return mapInfraErr(r.store.DeletePushSubscription(ctx, userID, subscriptionID))
}

func (r pushRepo) ListPushSubscriptions(ctx context.Context, userID string) (api.ListPushSubscriptionsResponse, error) {
	res, err := r.store.ListPushSubscriptions(ctx, userID)
	return res, mapInfraErr(err)
}
