package store

import (
	"context"
	"errors"
	"fmt"
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
	required, err = normalizeRequiredCompletionsPerWeek(req.Type, required)
	if err != nil {
		return api.Task{}, err
	}
	penalty32, err := safeInt32(req.PenaltyPoints, "penalty points")
	if err != nil {
		return api.Task{}, err
	}
	required32, err := safeInt32(required, "required completions")
	if err != nil {
		return api.Task{}, err
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
		Required:   required,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if _, err := s.runWithTeamRevisionCAS(
		ctx,
		teamID,
		"task",
		map[string]string{"taskId": task.ID, "action": "create"},
		func(_ context.Context, qtx *dbsqlc.Queries) error {
			return qtx.CreateTask(ctx, dbsqlc.CreateTaskParams{
				ID:                         task.ID,
				TeamID:                     task.TeamID,
				Title:                      task.Title,
				Notes:                      textFromPtr(task.Notes),
				Type:                       string(task.Type),
				PenaltyPoints:              penalty32,
				Column7:                    uuidStringFromPtr(task.AssigneeID),
				RequiredCompletionsPerWeek: required32,
				CreatedAt:                  toPgTimestamptz(task.CreatedAt),
				UpdatedAt:                  toPgTimestamptz(task.UpdatedAt),
			})
		},
	); err != nil {
		return api.Task{}, err
	}
	return task.toAPI(), nil
}

func (s *Store) PatchTask(ctx context.Context, userID, taskID string, req api.UpdateTaskRequest) (api.Task, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.Task{}, err
	}
	var task taskRecord
	if _, err := s.runWithTeamRevisionCAS(
		ctx,
		teamID,
		"task",
		map[string]string{"taskId": taskID, "action": "update"},
		func(_ context.Context, qtx *dbsqlc.Queries) error {
			row, err := qtx.GetTaskByID(ctx, taskID)
			if err != nil {
				return errors.New("task not found")
			}
			task = taskFromGetRow(row, s.loc)
			if task.TeamID != teamID || task.DeletedAt != nil {
				return errors.New("task not found")
			}
			if req.Title != nil {
				title := strings.TrimSpace(*req.Title)
				if title == "" {
					return errors.New("title cannot be empty")
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
			if req.RequiredCompletionsPerWeek != nil && task.Type == api.Weekly {
				required, err := normalizeRequiredCompletionsPerWeek(
					task.Type,
					*req.RequiredCompletionsPerWeek,
				)
				if err != nil {
					return err
				}
				task.Required = required
			}
			task.UpdatedAt = time.Now().In(s.loc)
			penalty32, err := safeInt32(task.Penalty, "penalty points")
			if err != nil {
				return err
			}
			required32, err := safeInt32(task.Required, "required completions")
			if err != nil {
				return err
			}
			return qtx.UpdateTask(ctx, dbsqlc.UpdateTaskParams{
				ID:                         task.ID,
				Title:                      task.Title,
				Notes:                      textFromPtr(task.Notes),
				PenaltyPoints:              penalty32,
				Column5:                    uuidStringFromPtr(task.AssigneeID),
				RequiredCompletionsPerWeek: required32,
				UpdatedAt:                  toPgTimestamptz(task.UpdatedAt),
			})
		},
	); err != nil {
		return api.Task{}, err
	}
	return task.toAPI(), nil
}

func normalizeRequiredCompletionsPerWeek(taskType api.TaskType, required int) (int, error) {
	if taskType == api.Daily {
		return requiredCompletionsPerWeekMin, nil
	}
	if required < requiredCompletionsPerWeekMin || required > requiredCompletionsPerWeekMax {
		return 0, fmt.Errorf(
			"required completions per week must be between %d and %d",
			requiredCompletionsPerWeekMin,
			requiredCompletionsPerWeekMax,
		)
	}
	return required, nil
}

func (s *Store) DeleteTask(ctx context.Context, userID, taskID string) error {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return err
	}
	_, err = s.runWithTeamRevisionCAS(
		ctx,
		teamID,
		"task",
		map[string]string{"taskId": taskID, "action": "delete"},
		func(_ context.Context, qtx *dbsqlc.Queries) error {
			row, err := qtx.GetTaskByID(ctx, taskID)
			if err != nil {
				return errors.New("task not found")
			}
			task := taskFromGetRow(row, s.loc)
			if task.TeamID != teamID || task.DeletedAt != nil {
				return errors.New("task not found")
			}
			return qtx.DeleteTask(ctx, taskID)
		},
	)
	return err
}

func (s *Store) ToggleTaskCompletion(ctx context.Context, userID, taskID string, target time.Time, action *api.ToggleTaskCompletionRequestAction) (api.TaskCompletionResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.TaskCompletionResponse{}, err
	}
	mode := api.Toggle
	if action != nil {
		mode = *action
		if mode == "" {
			mode = api.Toggle
		}
	}
	actionName := string(mode)
	res := api.TaskCompletionResponse{}
	if _, err := s.runWithTeamRevisionCAS(
		ctx,
		teamID,
		"task_completion",
		map[string]string{"taskId": taskID, "action": actionName},
		func(txCtx context.Context, _ *dbsqlc.Queries) error {
			q := s.queries(txCtx)
			row, err := q.GetTaskByID(txCtx, taskID)
			if err != nil {
				return errors.New("task not found")
			}
			task := taskFromGetRow(row, s.loc)
			if task.TeamID != teamID || task.DeletedAt != nil {
				return errors.New("task not found")
			}
			today := dateOnly(time.Now().In(s.loc), s.loc)
			targetDate := dateOnly(target.In(s.loc), s.loc)
			if task.Type == api.Daily && !sameDate(targetDate, today) {
				return errors.New("daily completion can only be toggled for today")
			}
			if task.Type == api.Weekly {
				weekStart := startOfWeek(today, s.loc)
				weekEnd := weekStart.AddDate(0, 0, 6)
				if targetDate.Before(weekStart) || targetDate.After(weekEnd) {
					return errors.New("weekly completion can only be toggled within current week")
				}
			}

			targetPg := toPgDate(targetDate)
			if task.Type == api.Daily {
				if mode != api.Toggle {
					return errors.New("daily tasks only support toggle action")
				}
				exists, err := q.HasTaskCompletionDaily(txCtx, dbsqlc.HasTaskCompletionDailyParams{
					TaskID:     taskID,
					TargetDate: targetPg,
				})
				if err != nil {
					return err
				}
				if exists {
					if err := q.DeleteTaskCompletionDaily(txCtx, dbsqlc.DeleteTaskCompletionDailyParams{
						TaskID:     taskID,
						TargetDate: targetPg,
					}); err != nil {
						return err
					}
				} else {
					if err := q.CreateTaskCompletionDaily(txCtx, dbsqlc.CreateTaskCompletionDailyParams{
						TaskID:            taskID,
						TargetDate:        targetPg,
						CompletedByUserID: userID,
					}); err != nil {
						return err
					}
				}
				res = api.TaskCompletionResponse{
					TaskId:               taskID,
					TargetDate:           toDate(targetDate),
					Completed:            !exists,
					WeeklyCompletedCount: 0,
				}
				return nil
			}

			weekStart := startOfWeek(targetDate, s.loc)
			weekStartPg := toPgDate(weekStart)
			currentCount, err := q.GetTaskCompletionWeeklyEntryCount(txCtx, dbsqlc.GetTaskCompletionWeeklyEntryCountParams{
				TaskID:    taskID,
				WeekStart: weekStartPg,
			})
			if err != nil {
				return err
			}
			nextCount := currentCount
			if task.Required <= 1 {
				if mode != api.Toggle {
					return errors.New("weekly tasks with required completions of 1 only support toggle action")
				}
				if currentCount > 0 {
					deletedRows, err := q.DeleteLatestTaskCompletionWeeklyEntry(txCtx, dbsqlc.DeleteLatestTaskCompletionWeeklyEntryParams{
						TaskID:    taskID,
						WeekStart: weekStartPg,
					})
					if err != nil {
						return err
					}
					if deletedRows > 0 {
						nextCount = currentCount - 1
					}
				} else {
					if err := q.InsertTaskCompletionWeeklyEntry(txCtx, dbsqlc.InsertTaskCompletionWeeklyEntryParams{
						ID:                s.nextID("twce"),
						TaskID:            taskID,
						WeekStart:         weekStartPg,
						CompletedByUserID: userID,
					}); err != nil {
						return err
					}
					nextCount = 1
				}
			} else {
				switch mode {
				case api.Toggle, api.Increment:
					if currentCount >= int64(task.Required) {
						nextCount = currentCount
						break
					}
					if err := q.InsertTaskCompletionWeeklyEntry(txCtx, dbsqlc.InsertTaskCompletionWeeklyEntryParams{
						ID:                s.nextID("twce"),
						TaskID:            taskID,
						WeekStart:         weekStartPg,
						CompletedByUserID: userID,
					}); err != nil {
						return err
					}
					nextCount = currentCount + 1
				case api.Decrement:
					if currentCount <= 0 {
						nextCount = 0
						break
					}
					deletedRows, err := q.DeleteLatestTaskCompletionWeeklyEntry(txCtx, dbsqlc.DeleteLatestTaskCompletionWeeklyEntryParams{
						TaskID:    taskID,
						WeekStart: weekStartPg,
					})
					if err != nil {
						return err
					}
					if deletedRows > 0 {
						nextCount = currentCount - 1
					}
				default:
					return errors.New("invalid completion action")
				}
			}

			res = api.TaskCompletionResponse{
				TaskId:               taskID,
				TargetDate:           toDate(targetDate),
				Completed:            nextCount > 0,
				WeeklyCompletedCount: int(nextCount),
			}
			return nil
		},
	); err != nil {
		return api.TaskCompletionResponse{}, err
	}
	return res, nil
}
