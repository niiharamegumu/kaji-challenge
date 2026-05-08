package repositories

import (
	"context"

	model "github.com/megu/kaji-challenge/backend/internal/http/application/model"
)

func (r pushRepo) UpsertPushSubscription(ctx context.Context, userID string, req model.UpsertPushSubscriptionRequest) (model.PushSubscription, error) {
	res, err := r.store.UpsertPushSubscription(ctx, userID, req)
	return res, mapInfraErr(err)
}

func (r pushRepo) DeletePushSubscription(ctx context.Context, userID, subscriptionID string) error {
	return mapInfraErr(r.store.DeletePushSubscription(ctx, userID, subscriptionID))
}

func (r pushRepo) ListPushSubscriptions(ctx context.Context, userID string) (model.ListPushSubscriptionsResponse, error) {
	res, err := r.store.ListPushSubscriptions(ctx, userID)
	return res, mapInfraErr(err)
}
