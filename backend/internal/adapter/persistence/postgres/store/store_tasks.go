package store

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	"github.com/megu/kaji-challenge/backend/internal/domain/sortkey"
	domaintask "github.com/megu/kaji-challenge/backend/internal/domain/task"
)

func (s *Store) ListTasks(ctx context.Context, userID string, filter *model.TaskType) ([]model.Task, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListTasksByTeamID(ctx, teamID)
	if err != nil {
		return nil, err
	}
	items := []model.Task{}
	for _, row := range rows {
		t := taskFromListRow(row, s.loc)
		if filter != nil && t.Type != *filter {
			continue
		}
		items = append(items, t.toAPI())
	}
	return items, nil
}

func (s *Store) CreateTask(ctx context.Context, userID string, req model.CreateTaskRequest) (model.Task, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return model.Task{}, err
	}
	title, err := domaintask.NormalizeTitle(req.Title)
	if err != nil {
		return model.Task{}, err
	}

	required := 1
	if req.Type == model.TaskTypeWeekly && req.RequiredCompletionsPerWeek != nil {
		required = *req.RequiredCompletionsPerWeek
	}
	required, err = domaintask.NormalizeRequiredCompletionsPerWeek(domainTaskType(req.Type), required)
	if err != nil {
		return model.Task{}, err
	}
	penalty32, err := safeInt32(req.PenaltyPoints, "penalty points")
	if err != nil {
		return model.Task{}, err
	}
	required32, err := safeInt32(required, "required completions")
	if err != nil {
		return model.Task{}, err
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
			rows, err := qtx.ListTasksByTeamID(txCtx, teamID)
			if err != nil {
				return err
			}
			existingIDs := make([]string, 0, len(rows))
			var firstSortKey int32
			for _, row := range rows {
				if row.Type != string(req.Type) {
					continue
				}
				if len(existingIDs) == 0 {
					firstSortKey = row.SortKey
				}
				existingIDs = append(existingIDs, row.ID)
			}
			sortKey32, hasGap := sortkey.Prepend(firstSortKey)
			if !hasGap {
				for index, existingID := range existingIDs {
					sortKey, err := sortkey.ForIndex(index + 1)
					if err != nil {
						return err
					}
					if err := qtx.UpdateTaskSortKey(txCtx, dbsqlc.UpdateTaskSortKeyParams{
						ID:        existingID,
						SortKey:   sortKey,
						UpdatedAt: toPgTimestamptz(now),
					}); err != nil {
						return err
					}
				}
			}
			task.SortKey = int(sortKey32)
			return qtx.CreateTask(txCtx, dbsqlc.CreateTaskParams{
				ID:                         task.ID,
				TeamID:                     task.TeamID,
				Title:                      task.Title,
				Notes:                      textFromPtr(task.Notes),
				Type:                       string(task.Type),
				PenaltyPoints:              penalty32,
				Column7:                    uuidStringFromPtr(task.AssigneeID),
				RequiredCompletionsPerWeek: required32,
				SortKey:                    sortKey32,
				CreatedAt:                  toPgTimestamptz(task.CreatedAt),
				UpdatedAt:                  toPgTimestamptz(task.UpdatedAt),
			})
		},
	); err != nil {
		return model.Task{}, err
	}
	return task.toAPI(), nil
}

func (s *Store) PatchTask(ctx context.Context, userID, taskID string, req model.UpdateTaskRequest) (model.Task, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return model.Task{}, err
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
				title, err := domaintask.NormalizePatchTitle(*req.Title)
				if err != nil {
					return err
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
			if req.RequiredCompletionsPerWeek != nil && task.Type == model.TaskTypeWeekly {
				required, err := domaintask.NormalizeRequiredCompletionsPerWeek(
					domainTaskType(task.Type),
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
		return model.Task{}, err
	}
	return task.toAPI(), nil
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
			return nil
		},
	)
	return err
}

func (s *Store) ReorderTasks(ctx context.Context, userID string, req model.ReorderTasksRequest) ([]model.Task, error) {
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

	items := make([]model.Task, 0, len(req.TaskIds))
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
			currentIDsSorted := append([]string(nil), currentIDs...)
			slices.Sort(currentIDsSorted)
			slices.Sort(requestedIDs)
			if !slices.Equal(currentIDsSorted, requestedIDs) {
				return errors.New("taskIds must match current tasks in the team and type")
			}

			now := s.now()
			movedTaskID := sortkey.FindMovedID(currentIDs, req.TaskIds)
			currentSortKeys := make(map[string]int32, len(currentIDs))
			for taskID, task := range tasksByID {
				v, err := safeInt32(task.SortKey, "sort key")
				if err != nil {
					return err
				}
				currentSortKeys[taskID] = v
			}

			if movedTaskID != "" {
				nextSortKey, ok, err := sortkey.MovedItemSortKey(req.TaskIds, currentSortKeys, movedTaskID)
				if err != nil {
					return err
				}
				if ok {
					if err := qtx.UpdateTaskSortKey(txCtx, dbsqlc.UpdateTaskSortKeyParams{
						ID:        movedTaskID,
						SortKey:   nextSortKey,
						UpdatedAt: toPgTimestamptz(now),
					}); err != nil {
						return err
					}
					task := tasksByID[movedTaskID]
					task.SortKey = int(nextSortKey)
					task.UpdatedAt = now
					tasksByID[movedTaskID] = task
				} else {
					for index, taskID := range req.TaskIds {
						sortKey, err := sortkey.ForIndex(index)
						if err != nil {
							return err
						}
						if err := qtx.UpdateTaskSortKey(txCtx, dbsqlc.UpdateTaskSortKeyParams{
							ID:        taskID,
							SortKey:   sortKey,
							UpdatedAt: toPgTimestamptz(now),
						}); err != nil {
							return err
						}
						task := tasksByID[taskID]
						task.SortKey = int(sortKey)
						task.UpdatedAt = now
						tasksByID[taskID] = task
					}
				}
			} else {
				for index, taskID := range req.TaskIds {
					sortKey, err := sortkey.ForIndex(index)
					if err != nil {
						return err
					}
					if err := qtx.UpdateTaskSortKey(txCtx, dbsqlc.UpdateTaskSortKeyParams{
						ID:        taskID,
						SortKey:   sortKey,
						UpdatedAt: toPgTimestamptz(now),
					}); err != nil {
						return err
					}
					task := tasksByID[taskID]
					task.SortKey = int(sortKey)
					task.UpdatedAt = now
					tasksByID[taskID] = task
				}
			}

			for _, taskID := range req.TaskIds {
				task := tasksByID[taskID]
				items = append(items, task.toAPI())
			}
			return nil
		},
	); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Store) ToggleTaskCompletion(ctx context.Context, userID, taskID string, target time.Time, action *model.ToggleTaskCompletionRequestAction) (model.TaskCompletionResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return model.TaskCompletionResponse{}, err
	}
	domainAction := domaintask.NormalizeCompletionAction(domainCompletionActionPtr(action))
	mode := modelCompletionAction(domainAction)
	actionName := string(mode)
	res := model.TaskCompletionResponse{}
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
			pastWeeklyCompletion := false
			if task.Type == model.TaskTypeWeekly {
				targetWeekStart := startOfWeek(targetDate, s.loc)
				targetWeekEnd := targetWeekStart.AddDate(0, 0, 6)
				targetMonth := monthKeyFromTime(targetWeekEnd, s.loc)
				currentMonth := monthKeyFromTime(today, s.loc)
				monthClosed := false
				if targetWeekEnd.Before(today) && targetMonth == currentMonth {
					summary, err := s.ensureMonthSummaryLocked(txCtx, teamID, targetMonth)
					if err != nil {
						return err
					}
					monthClosed = summary.IsClosed
				}
				var err error
				pastWeeklyCompletion, err = domaintask.ValidateWeeklyAction(targetDate, today, targetWeekStart, targetWeekEnd, targetMonth, currentMonth, monthClosed, domainAction)
				if err != nil {
					return err
				}
			}

			targetPg := toPgDate(targetDate)
			if task.Type == model.TaskTypeDaily {
				targetMonth := monthKeyFromTime(targetDate, s.loc)
				currentMonth := monthKeyFromTime(today, s.loc)
				monthClosed := false
				if !sameDate(targetDate, today) && !targetDate.After(today) && targetMonth == currentMonth {
					summary, err := s.ensureMonthSummaryLocked(txCtx, teamID, targetMonth)
					if err != nil {
						return err
					}
					monthClosed = summary.IsClosed
				}
				if err := domaintask.ValidateDailyAction(targetDate, today, targetMonth, currentMonth, monthClosed, domainAction); err != nil {
					return err
				}
				isToday := sameDate(targetDate, today)
				exists, err := q.HasTaskCompletionDaily(txCtx, dbsqlc.HasTaskCompletionDailyParams{
					TaskID:     taskID,
					TargetDate: targetPg,
				})
				if err != nil {
					return err
				}
				if exists {
					res = model.TaskCompletionResponse{
						TaskId:               taskID,
						TargetDate:           toDate(targetDate),
						Completed:            true,
						WeeklyCompletedCount: 0,
					}
					if !isToday && mode == model.Complete {
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
					if !isToday && mode == model.Complete {
						if err := s.recalculateOpenMonthDailyPenaltyLocked(txCtx, teamID, targetMonth); err != nil {
							return err
						}
					}
				}
				res = model.TaskCompletionResponse{
					TaskId:               taskID,
					TargetDate:           toDate(targetDate),
					Completed:            isToday && !exists || (!isToday && mode == model.Complete),
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
			nextCount, shouldMutate, err := domaintask.NextWeeklyCompletionCount(currentCount, task.Required, domainAction)
			if err != nil {
				return err
			}
			if task.Required <= 1 {
				if shouldMutate && currentCount > 0 {
					deletedRows, err := q.DeleteLatestTaskCompletionWeeklyEntry(txCtx, dbsqlc.DeleteLatestTaskCompletionWeeklyEntryParams{
						TaskID:    taskID,
						WeekStart: weekStartPg,
					})
					if err != nil {
						return err
					}
					if deletedRows == 0 {
						nextCount = currentCount
					}
				} else if shouldMutate {
					if err := q.InsertTaskCompletionWeeklyEntry(txCtx, dbsqlc.InsertTaskCompletionWeeklyEntryParams{
						ID:                s.nextID("twce"),
						TaskID:            taskID,
						WeekStart:         weekStartPg,
						CompletedByUserID: userID,
					}); err != nil {
						return err
					}
				}
			} else {
				switch mode {
				case model.Toggle, model.Increment:
					if shouldMutate {
						if err := q.InsertTaskCompletionWeeklyEntry(txCtx, dbsqlc.InsertTaskCompletionWeeklyEntryParams{
							ID:                s.nextID("twce"),
							TaskID:            taskID,
							WeekStart:         weekStartPg,
							CompletedByUserID: userID,
						}); err != nil {
							return err
						}
					}
				case model.Decrement:
					if shouldMutate {
						deletedRows, err := q.DeleteLatestTaskCompletionWeeklyEntry(txCtx, dbsqlc.DeleteLatestTaskCompletionWeeklyEntryParams{
							TaskID:    taskID,
							WeekStart: weekStartPg,
						})
						if err != nil {
							return err
						}
						if deletedRows == 0 {
							nextCount = currentCount
						}
					}
				default:
					return errors.New("invalid completion action")
				}
			}

			res = model.TaskCompletionResponse{
				TaskId:               taskID,
				TargetDate:           toDate(targetDate),
				Completed:            nextCount > 0,
				WeeklyCompletedCount: int(nextCount),
			}
			if pastWeeklyCompletion && shouldMutate {
				if err := s.recalculateOpenMonthWeeklyPenaltyLocked(txCtx, teamID, monthKeyFromTime(weekStart.AddDate(0, 0, 6), s.loc)); err != nil {
					return err
				}
			}
			return nil
		},
	); err != nil {
		return model.TaskCompletionResponse{}, err
	}
	return res, nil
}

func domainTaskType(value model.TaskType) domaintask.Type {
	return domaintask.Type(value)
}

func domainCompletionActionPtr(value *model.ToggleTaskCompletionRequestAction) *domaintask.CompletionAction {
	if value == nil {
		return nil
	}
	action := domaintask.CompletionAction(*value)
	return &action
}

func modelCompletionAction(value domaintask.CompletionAction) model.ToggleTaskCompletionRequestAction {
	return model.ToggleTaskCompletionRequestAction(value)
}
