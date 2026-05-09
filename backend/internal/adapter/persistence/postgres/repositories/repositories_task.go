package repositories

import (
	"context"
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
)

func (r taskRepo) ListTasks(ctx context.Context, userID string, filter *model.TaskType) ([]model.Task, error) {
	items, err := r.store.ListTasks(ctx, userID, filter)
	return items, mapInfraErr(err)
}

func (r taskRepo) CreateTask(ctx context.Context, userID string, req model.CreateTaskRequest) (model.Task, error) {
	res, err := r.store.CreateTask(ctx, userID, req)
	return res, mapInfraErr(err)
}

func (r taskRepo) PatchTask(ctx context.Context, userID, taskID string, req model.UpdateTaskRequest) (model.Task, error) {
	res, err := r.store.PatchTask(ctx, userID, taskID, req)
	return res, mapInfraErr(err)
}

func (r taskRepo) DeleteTask(ctx context.Context, userID, taskID string) error {
	return mapInfraErr(r.store.DeleteTask(ctx, userID, taskID))
}

func (r taskRepo) ReorderTasks(ctx context.Context, userID string, req model.ReorderTasksRequest) ([]model.Task, error) {
	items, err := r.store.ReorderTasks(ctx, userID, req)
	return items, mapInfraErr(err)
}

func (r taskRepo) ToggleTaskCompletion(ctx context.Context, userID, taskID string, target time.Time, action *model.ToggleTaskCompletionRequestAction) (model.TaskCompletionResponse, error) {
	res, err := r.store.ToggleTaskCompletion(ctx, userID, taskID, target, action)
	return res, mapInfraErr(err)
}
