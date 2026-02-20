package store

import (
	"context"
	"fmt"
	"sort"
	"time"

	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (s *Store) GetTaskOverview(ctx context.Context, userID string) (api.TaskOverviewResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.TaskOverviewResponse{}, err
	}

	now := time.Now().In(s.loc)
	if err := s.autoCloseLocked(ctx, now, teamID); err != nil {
		return api.TaskOverviewResponse{}, err
	}

	today := dateOnly(now, s.loc)
	weekStart := startOfWeek(today, s.loc)
	monthKey := monthKeyFromTime(today, s.loc)
	monthly, err := s.ensureMonthSummaryLocked(ctx, teamID, monthKey)
	if err != nil {
		return api.TaskOverviewResponse{}, err
	}
	daily := []api.TaskOverviewDailyTask{}
	weekly := []api.TaskOverviewWeeklyTask{}

	tasks, err := s.q.ListActiveTasksByTeamID(ctx, teamID)
	if err != nil {
		return api.TaskOverviewResponse{}, err
	}
	for _, row := range tasks {
		t := taskFromActiveListRow(row, s.loc)
		if t.Type == api.Daily {
			done, err := s.q.HasTaskCompletionDaily(ctx, dbsqlc.HasTaskCompletionDailyParams{
				TaskID:     t.ID,
				TargetDate: toPgDate(today),
			})
			if err != nil {
				return api.TaskOverviewResponse{}, err
			}
			daily = append(daily, api.TaskOverviewDailyTask{
				Task:           t.toAPI(),
				CompletedToday: done,
			})
			continue
		}
		count, err := s.weeklyCompletionCountLocked(ctx, t.ID, weekStart)
		if err != nil {
			return api.TaskOverviewResponse{}, err
		}
		weekly = append(weekly, api.TaskOverviewWeeklyTask{
			Task:                       t.toAPI(),
			WeekCompletedCount:         count,
			RequiredCompletionsPerWeek: t.Required,
		})
	}

	sort.Slice(daily, func(i, j int) bool { return daily[i].Task.CreatedAt.Before(daily[j].Task.CreatedAt) })
	sort.Slice(weekly, func(i, j int) bool { return weekly[i].Task.CreatedAt.Before(weekly[j].Task.CreatedAt) })

	elapsed := int(today.Sub(weekStart).Hours()/24) + 1
	return api.TaskOverviewResponse{
		Month:               monthKey,
		Today:               toDate(today),
		ElapsedDaysInWeek:   elapsed,
		MonthlyPenaltyTotal: int(monthly.DailyPenaltyTotal + monthly.WeeklyPenaltyTotal),
		DailyTasks:          daily,
		WeeklyTasks:         weekly,
	}, nil
}

func (s *Store) GetMonthlySummary(ctx context.Context, userID string, month *string) (api.MonthlyPenaltySummary, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.MonthlyPenaltySummary{}, err
	}
	targetMonth := time.Now().In(s.loc).Format("2006-01")
	if month != nil && *month != "" {
		targetMonth = *month
	}
	summary, err := s.ensureMonthSummaryLocked(ctx, teamID, targetMonth)
	if err != nil {
		return api.MonthlyPenaltySummary{}, err
	}
	var triggered []string
	if summary.IsClosed {
		triggered, err = s.q.ListTriggeredRuleIDsByMonth(ctx, dbsqlc.ListTriggeredRuleIDsByMonthParams{
			TeamID:     teamID,
			MonthStart: summary.MonthStart,
		})
		if err != nil {
			return api.MonthlyPenaltySummary{}, err
		}
	} else {
		activeRules, err := s.q.ListActivePenaltyRulesByTeamID(ctx, teamID)
		if err != nil {
			return api.MonthlyPenaltySummary{}, err
		}
		total := int(summary.DailyPenaltyTotal + summary.WeeklyPenaltyTotal)
		triggered = make([]string, 0, len(activeRules))
		for _, rule := range activeRules {
			if total >= int(rule.Threshold) {
				triggered = append(triggered, rule.ID)
			}
		}
	}
	taskStatusByDate, err := s.buildMonthlyTaskStatusByDate(ctx, teamID, targetMonth)
	if err != nil {
		return api.MonthlyPenaltySummary{}, err
	}
	return monthSummary{
		TeamID:           summary.TeamID,
		Month:            monthKeyFromTime(summary.MonthStart.Time, s.loc),
		DailyPenalty:     int(summary.DailyPenaltyTotal),
		WeeklyPenalty:    int(summary.WeeklyPenaltyTotal),
		IsClosed:         summary.IsClosed,
		TriggeredRuleID:  triggered,
		TaskStatusByDate: taskStatusByDate,
	}.toAPI(), nil
}

type monthlyTaskStatusRecord struct {
	ID        string
	Title     string
	Type      api.TaskType
	Penalty   int
	CreatedAt time.Time
	DeletedAt *time.Time
}

func (s *Store) buildMonthlyTaskStatusByDate(ctx context.Context, teamID, month string) ([]api.MonthlyTaskStatusGroup, error) {
	monthStart, err := monthStartFromKey(month, s.loc)
	if err != nil {
		return nil, err
	}
	monthEnd := monthStart.AddDate(0, 1, 0)

	taskRows, err := s.q.ListTasksForMonthlyStatusByTeam(ctx, dbsqlc.ListTasksForMonthlyStatusByTeamParams{
		TeamID:    teamID,
		DeletedAt: toPgTimestamptz(monthStart),
		CreatedAt: toPgTimestamptz(monthEnd),
	})
	if err != nil {
		return nil, err
	}
	tasks := make([]monthlyTaskStatusRecord, 0, len(taskRows))
	for _, row := range taskRows {
		tasks = append(tasks, monthlyTaskStatusRecord{
			ID:        row.ID,
			Title:     row.Title,
			Type:      api.TaskType(row.Type),
			Penalty:   int(row.PenaltyPoints),
			CreatedAt: row.CreatedAt.Time.In(s.loc),
			DeletedAt: ptrFromTimestamptz(row.DeletedAt, s.loc),
		})
	}

	dailyRows, err := s.q.ListTaskCompletionDailyByMonthAndTeam(ctx, dbsqlc.ListTaskCompletionDailyByMonthAndTeamParams{
		TeamID:       teamID,
		TargetDate:   toPgDate(monthStart),
		TargetDate_2: toPgDate(monthEnd),
	})
	if err != nil {
		return nil, err
	}
	dailyDone := map[string]map[string]bool{}
	for _, row := range dailyRows {
		dateKey := row.TargetDate.Time.In(s.loc).Format("2006-01-02")
		if dailyDone[dateKey] == nil {
			dailyDone[dateKey] = map[string]bool{}
		}
		dailyDone[dateKey][row.TaskID] = true
	}

	weeklyRows, err := s.q.ListTaskCompletionWeeklyByMonthAndTeam(ctx, dbsqlc.ListTaskCompletionWeeklyByMonthAndTeamParams{
		TeamID:      teamID,
		WeekStart:   toPgDate(monthStart),
		WeekStart_2: toPgDate(monthEnd),
	})
	if err != nil {
		return nil, err
	}
	weeklyDone := map[string]map[string]bool{}
	for _, row := range weeklyRows {
		dateKey := row.WeekStart.Time.In(s.loc).Format("2006-01-02")
		if weeklyDone[dateKey] == nil {
			weeklyDone[dateKey] = map[string]bool{}
		}
		weeklyDone[dateKey][row.TaskID] = row.CompletionCount > 0
	}

	groups := []api.MonthlyTaskStatusGroup{}
	for day := monthEnd.AddDate(0, 0, -1); !day.Before(monthStart); day = day.AddDate(0, 0, -1) {
		dayStart := dateOnly(day, s.loc)
		dayEnd := dayStart.AddDate(0, 0, 1)
		dayKey := dayStart.Format("2006-01-02")
		items := []api.MonthlyTaskStatusItem{}

		for _, task := range tasks {
			if task.CreatedAt.In(s.loc).After(dayEnd.Add(-time.Nanosecond)) {
				continue
			}
			if task.DeletedAt != nil && !task.DeletedAt.After(dayStart) {
				continue
			}

			completed := false
			switch task.Type {
			case api.Daily:
				completed = dailyDone[dayKey] != nil && dailyDone[dayKey][task.ID]
			case api.Weekly:
				if !sameDate(startOfWeek(dayStart, s.loc), dayStart) {
					continue
				}
				completed = weeklyDone[dayKey] != nil && weeklyDone[dayKey][task.ID]
			default:
				return nil, fmt.Errorf("unknown task type: %s", task.Type)
			}

			items = append(items, api.MonthlyTaskStatusItem{
				TaskId:        task.ID,
				Title:         task.Title,
				Type:          task.Type,
				PenaltyPoints: task.Penalty,
				Completed:     completed,
				IsDeleted:     task.DeletedAt != nil,
			})
		}

		if len(items) == 0 {
			continue
		}

		sort.Slice(items, func(i, j int) bool {
			if items[i].Type != items[j].Type {
				return items[i].Type < items[j].Type
			}
			return items[i].Title < items[j].Title
		})
		groups = append(groups, api.MonthlyTaskStatusGroup{
			Date:  toDate(dayStart),
			Items: items,
		})
	}

	return groups, nil
}
