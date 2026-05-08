package usecases

import (
	"context"

	model "github.com/megu/kaji-challenge/backend/internal/http/application/model"
)

func (u pushUsecase) UpsertPushSubscription(ctx context.Context, userID string, req model.UpsertPushSubscriptionRequest) (model.PushSubscription, error) {
	return u.repo.UpsertPushSubscription(ctx, userID, req)
}

func (u pushUsecase) DeletePushSubscription(ctx context.Context, userID, subscriptionID string) error {
	return u.repo.DeletePushSubscription(ctx, userID, subscriptionID)
}

func (u pushUsecase) ListPushSubscriptions(ctx context.Context, userID string) (model.ListPushSubscriptionsResponse, error) {
	return u.repo.ListPushSubscriptions(ctx, userID)
}
