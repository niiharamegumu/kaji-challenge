package usecases

import (
	"context"
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/http/application/model"
)

func (u taskUsecase) ListTasks(ctx context.Context, userID string, filter *model.TaskType) ([]model.Task, error) {
	return u.repo.ListTasks(ctx, userID, filter)
}

func (u taskUsecase) CreateTask(ctx context.Context, userID string, req model.CreateTaskRequest) (model.Task, error) {
	return u.repo.CreateTask(ctx, userID, req)
}

func (u taskUsecase) PatchTask(ctx context.Context, userID, taskID string, req model.UpdateTaskRequest) (model.Task, error) {
	return u.repo.PatchTask(ctx, userID, taskID, req)
}

func (u taskUsecase) DeleteTask(ctx context.Context, userID, taskID string) error {
	return u.repo.DeleteTask(ctx, userID, taskID)
}

func (u taskUsecase) ReorderTasks(ctx context.Context, userID string, req model.ReorderTasksRequest) ([]model.Task, error) {
	return u.repo.ReorderTasks(ctx, userID, req)
}

func (u taskUsecase) ToggleTaskCompletion(ctx context.Context, userID, taskID string, target time.Time, action *model.ToggleTaskCompletionRequestAction) (model.TaskCompletionResponse, error) {
	return u.repo.ToggleTaskCompletion(ctx, userID, taskID, target, action)
}
