package usecases

import (
	"context"

	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (u pushUsecase) UpsertPushSubscription(ctx context.Context, userID string, req api.UpsertPushSubscriptionRequest) (api.PushSubscription, error) {
	return u.repo.UpsertPushSubscription(ctx, userID, req)
}

func (u pushUsecase) DeletePushSubscription(ctx context.Context, userID, subscriptionID string) error {
	return u.repo.DeletePushSubscription(ctx, userID, subscriptionID)
}

func (u pushUsecase) ListPushSubscriptions(ctx context.Context, userID string) (api.ListPushSubscriptionsResponse, error) {
	return u.repo.ListPushSubscriptions(ctx, userID)
}
