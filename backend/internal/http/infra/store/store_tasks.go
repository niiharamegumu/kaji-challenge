package store

import (
	"context"
	"errors"
	"strings"
	"time"

	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (s *Store) ListTasks(ctx context.Context, userID string, filter *api.TaskType) ([]api.Task, error) {
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

func (s *Store) CreateTask(ctx context.Context, userID string, req api.CreateTaskRequest) (api.Task, error) {
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

func (s *Store) PatchTask(ctx context.Context, userID, taskID string, req api.UpdateTaskRequest) (api.Task, error) {
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

func (s *Store) DeleteTask(ctx context.Context, userID, taskID string) error {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return err
	}
	task, err := s.q.GetTaskByID(ctx, taskID)
	if err != nil || task.TeamID != teamID {
		return errors.New("task not found")
	}
	if err := s.q.DeleteTaskCompletionDailyByTaskID(ctx, taskID); err != nil {
		return err
	}
	if err := s.q.DeleteTaskCompletionWeeklyByTaskID(ctx, taskID); err != nil {
		return err
	}
	return s.q.DeleteTask(ctx, taskID)
}

func (s *Store) ToggleTaskCompletion(ctx context.Context, userID, taskID string, target time.Time, action *api.ToggleTaskCompletionRequestAction) (api.TaskCompletionResponse, error) {
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

	mode := api.Toggle
	if action != nil {
		mode = *action
		if mode == "" {
			mode = api.Toggle
		}
	}

	targetPg := toPgDate(targetDate)
	if task.Type == api.Daily {
		if mode != api.Toggle {
			return api.TaskCompletionResponse{}, errors.New("daily tasks only support toggle action")
		}
		exists, err := s.q.HasTaskCompletionDaily(ctx, dbsqlc.HasTaskCompletionDailyParams{
			TaskID:     taskID,
			TargetDate: targetPg,
		})
		if err != nil {
			return api.TaskCompletionResponse{}, err
		}
		if exists {
			if err := s.q.DeleteTaskCompletionDaily(ctx, dbsqlc.DeleteTaskCompletionDailyParams{
				TaskID:     taskID,
				TargetDate: targetPg,
			}); err != nil {
				return api.TaskCompletionResponse{}, err
			}
		} else {
			if err := s.q.CreateTaskCompletionDaily(ctx, dbsqlc.CreateTaskCompletionDailyParams{
				TaskID:     taskID,
				TargetDate: targetPg,
			}); err != nil {
				return api.TaskCompletionResponse{}, err
			}
		}
		return api.TaskCompletionResponse{
			TaskId:               taskID,
			TargetDate:           toDate(targetDate),
			Completed:            !exists,
			WeeklyCompletedCount: 0,
		}, nil
	}

	weekStart := startOfWeek(targetDate, s.loc)
	weekStartPg := toPgDate(weekStart)
	var nextCount int64
	if task.Required <= 1 {
		if mode != api.Toggle {
			return api.TaskCompletionResponse{}, errors.New("weekly tasks with required completions of 1 only support toggle action")
		}
		nextCount, err = s.q.ToggleTaskCompletionWeeklyBinary(ctx, dbsqlc.ToggleTaskCompletionWeeklyBinaryParams{
			TaskID:    taskID,
			WeekStart: weekStartPg,
		})
		if err != nil {
			return api.TaskCompletionResponse{}, err
		}
	} else {
		required32, err := safeInt32(task.Required, "required completions")
		if err != nil {
			return api.TaskCompletionResponse{}, err
		}
		switch mode {
		case api.Toggle, api.Increment:
			nextCount, err = s.q.IncrementTaskCompletionWeekly(ctx, dbsqlc.IncrementTaskCompletionWeeklyParams{
				TaskID:        taskID,
				WeekStart:     weekStartPg,
				MaxCompletion: required32,
			})
			if err != nil {
				return api.TaskCompletionResponse{}, err
			}
		case api.Decrement:
			nextCount, err = s.q.DecrementTaskCompletionWeekly(ctx, dbsqlc.DecrementTaskCompletionWeeklyParams{
				TaskID:    taskID,
				WeekStart: weekStartPg,
			})
			if err != nil {
				return api.TaskCompletionResponse{}, err
			}
		default:
			return api.TaskCompletionResponse{}, errors.New("invalid completion action")
		}
	}

	if nextCount <= 0 {
		if err := s.q.DeleteTaskCompletionWeeklyIfZero(ctx, dbsqlc.DeleteTaskCompletionWeeklyIfZeroParams{
			TaskID:    taskID,
			WeekStart: weekStartPg,
		}); err != nil {
			return api.TaskCompletionResponse{}, err
		}
	}

	return api.TaskCompletionResponse{
		TaskId:               taskID,
		TargetDate:           toDate(targetDate),
		Completed:            nextCount > 0,
		WeeklyCompletedCount: int(nextCount),
	}, nil
}
