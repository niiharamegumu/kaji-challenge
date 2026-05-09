package repositories

import (
	"context"
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	"github.com/megu/kaji-challenge/backend/internal/application/ports"
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

func (r pushRepo) ListPushTeamIDs(ctx context.Context) ([]string, error) {
	res, err := r.store.ListPushTeamIDs(ctx)
	return res, mapInfraErr(err)
}

func (r pushRepo) ListPendingPushTasks(ctx context.Context, teamID string, taskType model.TaskType, now, slotDate time.Time) ([]ports.PendingPushTask, error) {
	res, err := r.store.ListPendingPushTasks(ctx, teamID, taskType, now, slotDate)
	return res, mapInfraErr(err)
}

func (r pushRepo) ListActivePushSubscriptions(ctx context.Context, teamID string) ([]ports.PushSubscriptionTarget, error) {
	res, err := r.store.ListActivePushSubscriptions(ctx, teamID)
	return res, mapInfraErr(err)
}

func (r pushRepo) DeactivatePushSubscriptionByEndpoint(ctx context.Context, endpoint string, updatedAt time.Time) error {
	return mapInfraErr(r.store.DeactivatePushSubscriptionByEndpoint(ctx, endpoint, updatedAt))
}

func (r pushRepo) Now() time.Time {
	return r.store.Now()
}
