package repositories

import (
	"context"
	"time"

	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (r taskRepo) ListTasks(ctx context.Context, userID string, filter *api.TaskType) ([]api.Task, error) {
	items, err := r.store.ListTasks(ctx, userID, filter)
	return items, mapInfraErr(err)
}

func (r taskRepo) CreateTask(ctx context.Context, userID string, req api.CreateTaskRequest) (api.Task, error) {
	res, err := r.store.CreateTask(ctx, userID, req)
	return res, mapInfraErr(err)
}

func (r taskRepo) PatchTask(ctx context.Context, userID, taskID string, req api.UpdateTaskRequest) (api.Task, error) {
	res, err := r.store.PatchTask(ctx, userID, taskID, req)
	return res, mapInfraErr(err)
}

func (r taskRepo) DeleteTask(ctx context.Context, userID, taskID string) error {
	return mapInfraErr(r.store.DeleteTask(ctx, userID, taskID))
}

func (r taskRepo) ToggleTaskCompletion(ctx context.Context, userID, taskID string, target time.Time, action *api.ToggleTaskCompletionRequestAction) (api.TaskCompletionResponse, error) {
	res, err := r.store.ToggleTaskCompletion(ctx, userID, taskID, target, action)
	return res, mapInfraErr(err)
}
