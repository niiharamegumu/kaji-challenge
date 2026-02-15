package http

import (
	"context"
	"errors"
	"strings"
	"time"

	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (s *store) listTasks(ctx context.Context, userID string, filter *api.TaskType) ([]api.Task, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListTasksByTeamID(ctx, teamID)
	if err != nil {
		return nil, err
	}
	items := []api.Task{}
	for _, row := range rows {
		t := taskFromListRow(row, s.loc)
		if filter != nil && t.Type != *filter {
			continue
		}
		items = append(items, t.toAPI())
	}
	return items, nil
}

func (s *store) createTask(ctx context.Context, userID string, req api.CreateTaskRequest) (api.Task, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.Task{}, err
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		return api.Task{}, errors.New("title is required")
	}

	required := 1
	if req.Type == api.Weekly && req.RequiredCompletionsPerWeek != nil {
		required = *req.RequiredCompletionsPerWeek
	}
	if req.Type == api.Daily {
		required = 1
	}
	penalty32, err := safeInt32(req.PenaltyPoints, "penalty points")
	if err != nil {
		return api.Task{}, err
	}
	required32, err := safeInt32(required, "required completions")
	if err != nil {
		return api.Task{}, err
	}

	active := true
	if req.IsActive != nil {
		active = *req.IsActive
	}
	now := time.Now().In(s.loc)
	taskID := s.nextID("tsk")
	task := taskRecord{
		ID:         taskID,
		TeamID:     teamID,
		Title:      title,
		Notes:      req.Notes,
		Type:       req.Type,
		Penalty:    req.PenaltyPoints,
		AssigneeID: req.AssigneeUserId,
		IsActive:   active,
		Required:   required,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if err := s.q.CreateTask(ctx, dbsqlc.CreateTaskParams{
		ID:                         task.ID,
		TeamID:                     task.TeamID,
		Title:                      task.Title,
		Notes:                      textFromPtr(task.Notes),
		Type:                       string(task.Type),
		PenaltyPoints:              penalty32,
		Column7:                    uuidStringFromPtr(task.AssigneeID),
		IsActive:                   task.IsActive,
		RequiredCompletionsPerWeek: required32,
		CreatedAt:                  toPgTimestamptz(task.CreatedAt),
		UpdatedAt:                  toPgTimestamptz(task.UpdatedAt),
	}); err != nil {
		return api.Task{}, err
	}
	return task.toAPI(), nil
}

func (s *store) patchTask(ctx context.Context, userID, taskID string, req api.UpdateTaskRequest) (api.Task, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.Task{}, err
	}
	row, err := s.q.GetTaskByID(ctx, taskID)
	if err != nil {
		return api.Task{}, errors.New("task not found")
	}
	task := taskFromGetRow(row, s.loc)
	if task.TeamID != teamID {
		return api.Task{}, errors.New("task not found")
	}
	if req.Title != nil {
		title := strings.TrimSpace(*req.Title)
		if title == "" {
			return api.Task{}, errors.New("title cannot be empty")
		}
		task.Title = title
	}
	if req.Notes != nil {
		task.Notes = req.Notes
	}
	if req.PenaltyPoints != nil {
		task.Penalty = *req.PenaltyPoints
	}
	if req.AssigneeUserId != nil {
		task.AssigneeID = req.AssigneeUserId
	}
	if req.IsActive != nil {
		task.IsActive = *req.IsActive
	}
	if req.RequiredCompletionsPerWeek != nil && task.Type == api.Weekly {
		task.Required = *req.RequiredCompletionsPerWeek
	}
	task.UpdatedAt = time.Now().In(s.loc)
	penalty32, err := safeInt32(task.Penalty, "penalty points")
	if err != nil {
		return api.Task{}, err
	}
	required32, err := safeInt32(task.Required, "required completions")
	if err != nil {
		return api.Task{}, err
	}
	if err := s.q.UpdateTask(ctx, dbsqlc.UpdateTaskParams{
		ID:                         task.ID,
		Title:                      task.Title,
		Notes:                      textFromPtr(task.Notes),
		PenaltyPoints:              penalty32,
		Column5:                    uuidStringFromPtr(task.AssigneeID),
		IsActive:                   task.IsActive,
		RequiredCompletionsPerWeek: required32,
		UpdatedAt:                  toPgTimestamptz(task.UpdatedAt),
	}); err != nil {
		return api.Task{}, err
	}
	return task.toAPI(), nil
}

func (s *store) deleteTask(ctx context.Context, userID, taskID string) error {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return err
	}
	task, err := s.q.GetTaskByID(ctx, taskID)
	if err != nil || task.TeamID != teamID {
		return errors.New("task not found")
	}
	if err := s.q.DeleteTaskCompletionsByTaskID(ctx, taskID); err != nil {
		return err
	}
	return s.q.DeleteTask(ctx, taskID)
}

func (s *store) toggleTaskCompletion(ctx context.Context, userID, taskID string, target time.Time) (api.TaskCompletionResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.TaskCompletionResponse{}, err
	}
	row, err := s.q.GetTaskByID(ctx, taskID)
	if err != nil {
		return api.TaskCompletionResponse{}, errors.New("task not found")
	}
	task := taskFromGetRow(row, s.loc)
	if task.TeamID != teamID {
		return api.TaskCompletionResponse{}, errors.New("task not found")
	}
	if !task.IsActive {
		return api.TaskCompletionResponse{}, errors.New("task is inactive")
	}

	today := dateOnly(time.Now().In(s.loc), s.loc)
	targetDate := dateOnly(target.In(s.loc), s.loc)
	if task.Type == api.Daily && !sameDate(targetDate, today) {
		return api.TaskCompletionResponse{}, errors.New("daily completion can only be toggled for today")
	}
	if task.Type == api.Weekly {
		weekStart := startOfWeek(today, s.loc)
		weekEnd := weekStart.AddDate(0, 0, 6)
		if targetDate.Before(weekStart) || targetDate.After(weekEnd) {
			return api.TaskCompletionResponse{}, errors.New("weekly completion can only be toggled within current week")
		}
	}

	targetPg := toPgDate(targetDate)
	exists, err := s.q.HasTaskCompletion(ctx, dbsqlc.HasTaskCompletionParams{
		TaskID:     taskID,
		TargetDate: targetPg,
	})
	if err != nil {
		return api.TaskCompletionResponse{}, err
	}
	completed := !exists
	if completed {
		if err := s.q.CreateTaskCompletion(ctx, dbsqlc.CreateTaskCompletionParams{
			TaskID:     taskID,
			TargetDate: targetPg,
		}); err != nil {
			return api.TaskCompletionResponse{}, err
		}
	} else {
		if err := s.q.DeleteTaskCompletion(ctx, dbsqlc.DeleteTaskCompletionParams{
			TaskID:     taskID,
			TargetDate: targetPg,
		}); err != nil {
			return api.TaskCompletionResponse{}, err
		}
	}

	count, err := s.weeklyCompletionCountLocked(ctx, taskID, startOfWeek(targetDate, s.loc))
	if err != nil {
		return api.TaskCompletionResponse{}, err
	}
	return api.TaskCompletionResponse{
		TaskId:               taskID,
		TargetDate:           toDate(targetDate),
		Completed:            completed,
		WeeklyCompletedCount: count,
	}, nil
}
