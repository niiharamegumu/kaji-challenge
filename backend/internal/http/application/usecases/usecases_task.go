package usecases

import (
	"context"
	"time"

	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (u taskUsecase) ListTasks(ctx context.Context, userID string, filter *api.TaskType) ([]api.Task, error) {
	return u.repo.ListTasks(ctx, userID, filter)
}

func (u taskUsecase) CreateTask(ctx context.Context, userID string, req api.CreateTaskRequest) (api.Task, error) {
	return u.repo.CreateTask(ctx, userID, req)
}

func (u taskUsecase) PatchTask(ctx context.Context, userID, taskID string, req api.UpdateTaskRequest) (api.Task, error) {
	return u.repo.PatchTask(ctx, userID, taskID, req)
}

func (u taskUsecase) DeleteTask(ctx context.Context, userID, taskID string) error {
	return u.repo.DeleteTask(ctx, userID, taskID)
}

func (u taskUsecase) ToggleTaskCompletion(ctx context.Context, userID, taskID string, target time.Time) (api.TaskCompletionResponse, error) {
	return u.repo.ToggleTaskCompletion(ctx, userID, taskID, target)
}
