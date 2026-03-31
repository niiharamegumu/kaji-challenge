package store

import (
	"context"
	"errors"
	"fmt"
	"slices"
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
	if req.Type == api.TaskTypeWeekly && req.RequiredCompletionsPerWeek != nil {
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
		func(txCtx context.Context, qtx *dbsqlc.Queries) error {
			maxPosition, err := qtx.GetTaskMaxPositionByTeamAndType(txCtx, dbsqlc.GetTaskMaxPositionByTeamAndTypeParams{
				TeamID: teamID,
				Type:   string(req.Type),
			})
			if err != nil {
				return err
			}
			task.Position = int(maxPosition) + 1
			position32, err := safeInt32(task.Position, "position")
			if err != nil {
				return err
			}
			return qtx.CreateTask(ctx, dbsqlc.CreateTaskParams{
				ID:                         task.ID,
				TeamID:                     task.TeamID,
				Title:                      task.Title,
				Notes:                      textFromPtr(task.Notes),
				Type:                       string(task.Type),
				PenaltyPoints:              penalty32,
				Column7:                    uuidStringFromPtr(task.AssigneeID),
				RequiredCompletionsPerWeek: required32,
				Position:                   position32,
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
			if req.RequiredCompletionsPerWeek != nil && task.Type == api.TaskTypeWeekly {
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
	if taskType == api.TaskTypeDaily {
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
			if err := qtx.DeleteTask(ctx, taskID); err != nil {
				return err
			}
			position32, err := safeInt32(task.Position, "position")
			if err != nil {
				return err
			}
			return qtx.CompactTaskPositionsAfter(ctx, dbsqlc.CompactTaskPositionsAfterParams{
				TeamID:    teamID,
				Type:      string(task.Type),
				Position:  position32,
				UpdatedAt: toPgTimestamptz(s.now()),
			})
		},
	)
	return err
}

func (s *Store) ReorderTasks(ctx context.Context, userID string, req api.ReorderTasksRequest) ([]api.Task, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(req.TaskIds) == 0 {
		return nil, errors.New("taskIds is required")
	}
	seen := make(map[string]struct{}, len(req.TaskIds))
	for _, taskID := range req.TaskIds {
		if strings.TrimSpace(taskID) == "" {
			return nil, errors.New("taskIds contains empty id")
		}
		if _, exists := seen[taskID]; exists {
			return nil, errors.New("taskIds contains duplicate id")
		}
		seen[taskID] = struct{}{}
	}

	items := make([]api.Task, 0, len(req.TaskIds))
	if _, err := s.runWithTeamRevisionCAS(
		ctx,
		teamID,
		"task",
		map[string]string{"action": "reorder"},
		func(txCtx context.Context, qtx *dbsqlc.Queries) error {
			rows, err := qtx.ListTasksByTeamID(txCtx, teamID)
			if err != nil {
				return err
			}
			if len(rows) == 0 {
				return errors.New("tasks not found")
			}

			firstRow, err := qtx.GetTaskByID(txCtx, req.TaskIds[0])
			if err != nil {
				return errors.New("taskIds must match current tasks in the team and type")
			}
			firstTask := taskFromGetRow(firstRow, s.loc)
			if firstTask.TeamID != teamID || firstTask.DeletedAt != nil {
				return errors.New("taskIds must match current tasks in the team and type")
			}
			reorderType := firstTask.Type
			for _, taskID := range req.TaskIds {
				row, err := qtx.GetTaskByID(txCtx, taskID)
				if err != nil {
					return errors.New("taskIds must match current tasks in the team and type")
				}
				task := taskFromGetRow(row, s.loc)
				if task.TeamID != teamID || task.DeletedAt != nil || task.Type != reorderType {
					return errors.New("taskIds must match current tasks in the team and type")
				}
			}

			currentIDs := make([]string, 0, len(rows))
			tasksByID := make(map[string]taskRecord, len(rows))
			for _, row := range rows {
				task := taskFromListRow(row, s.loc)
				if task.Type != reorderType {
					continue
				}
				currentIDs = append(currentIDs, task.ID)
				tasksByID[task.ID] = task
			}
			if len(currentIDs) != len(req.TaskIds) {
				return errors.New("taskIds must include every task in the selected type")
			}
			requestedIDs := append([]string(nil), req.TaskIds...)
			slices.Sort(currentIDs)
			slices.Sort(requestedIDs)
			if !slices.Equal(currentIDs, requestedIDs) {
				return errors.New("taskIds must match current tasks in the team and type")
			}

			now := s.now()
			offsetBase := len(req.TaskIds) + 1
			for index, taskID := range req.TaskIds {
				tempPosition, convErr := safeInt32(offsetBase+index, "position")
				if convErr != nil {
					return convErr
				}
				if err := qtx.UpdateTaskPosition(txCtx, dbsqlc.UpdateTaskPositionParams{
					ID:        taskID,
					Position:  tempPosition,
					UpdatedAt: toPgTimestamptz(now),
				}); err != nil {
					return err
				}
			}
			for index, taskID := range req.TaskIds {
				finalPosition, convErr := safeInt32(index+1, "position")
				if convErr != nil {
					return convErr
				}
				if err := qtx.UpdateTaskPosition(txCtx, dbsqlc.UpdateTaskPositionParams{
					ID:        taskID,
					Position:  finalPosition,
					UpdatedAt: toPgTimestamptz(now),
				}); err != nil {
					return err
				}
				task := tasksByID[taskID]
				task.Position = index + 1
				task.UpdatedAt = now
				items = append(items, task.toAPI())
			}
			return nil
		},
	); err != nil {
		return nil, err
	}
	return items, nil
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
			today := dateOnly(s.now(), s.loc)
			targetDate := dateOnly(target.In(s.loc), s.loc)
			if task.Type == api.TaskTypeWeekly {
				weekStart := startOfWeek(today, s.loc)
				weekEnd := weekStart.AddDate(0, 0, 6)
				if targetDate.Before(weekStart) || targetDate.After(weekEnd) {
					return errors.New("weekly completion can only be toggled within current week")
				}
			}

			targetPg := toPgDate(targetDate)
			if task.Type == api.TaskTypeDaily {
				isToday := sameDate(targetDate, today)
				targetMonth := monthKeyFromTime(targetDate, s.loc)
				currentMonth := monthKeyFromTime(today, s.loc)
				if isToday {
					if mode != api.Toggle {
						return errors.New("daily tasks only support toggle action for today")
					}
				} else {
					if targetDate.After(today) {
						return errors.New("daily completion cannot be changed for future dates")
					}
					if targetMonth != currentMonth {
						return errors.New("daily completion can only be completed for past days in current month")
					}
					summary, err := s.ensureMonthSummaryLocked(txCtx, teamID, targetMonth)
					if err != nil {
						return err
					}
					if summary.IsClosed {
						return errors.New("daily completion cannot be changed for closed month")
					}
					if mode != api.Complete {
						return errors.New("past daily completion only supports complete action")
					}
				}
				exists, err := q.HasTaskCompletionDaily(txCtx, dbsqlc.HasTaskCompletionDailyParams{
					TaskID:     taskID,
					TargetDate: targetPg,
				})
				if err != nil {
					return err
				}
				if exists {
					res = api.TaskCompletionResponse{
						TaskId:               taskID,
						TargetDate:           toDate(targetDate),
						Completed:            true,
						WeeklyCompletedCount: 0,
					}
					if !isToday && mode == api.Complete {
						return nil
					}
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
					if !isToday && mode == api.Complete {
						if err := s.recalculateOpenMonthDailyPenaltyLocked(txCtx, teamID, targetMonth); err != nil {
							return err
						}
					}
				}
				res = api.TaskCompletionResponse{
					TaskId:               taskID,
					TargetDate:           toDate(targetDate),
					Completed:            isToday && !exists || (!isToday && mode == api.Complete),
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
