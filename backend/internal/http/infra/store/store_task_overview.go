package store

import (
	"context"
	"fmt"
	"sort"
	"time"

	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (s *Store) GetTaskOverview(ctx context.Context, userID string) (resp api.TaskOverviewResponse, err error) {
	startedAt := time.Now()
	queryCount := 0
	taskCount := 0
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.TaskOverviewResponse{}, err
	}
	defer func() {
		s.logSQLPerformance("get_task_overview", startedAt, queryCount, fmt.Sprintf("team_id=%s task_count=%d error=%t", teamID, taskCount, err != nil))
	}()

	now := time.Now().In(s.loc)
	today := dateOnly(now, s.loc)
	weekStart := startOfWeek(today, s.loc)
	monthKey := monthKeyFromTime(today, s.loc)
	monthly, err := s.ensureMonthSummaryLocked(ctx, teamID, monthKey)
	if err != nil {
		return api.TaskOverviewResponse{}, err
	}
	daily := []api.TaskOverviewDailyTask{}
	weekly := []api.TaskOverviewWeeklyTask{}

	tasks, err := s.q.ListUndeletedTasksByTeamID(ctx, teamID)
	queryCount++
	if err != nil {
		return api.TaskOverviewResponse{}, err
	}
	taskCount = len(tasks)

	dailyCompletedTaskIDs, err := s.q.ListCompletedDailyTaskIDsByTeamAndDate(ctx, dbsqlc.ListCompletedDailyTaskIDsByTeamAndDateParams{
		TeamID:     teamID,
		TargetDate: toPgDate(today),
	})
	queryCount++
	if err != nil {
		return api.TaskOverviewResponse{}, err
	}
	dailyDone := make(map[string]bool, len(dailyCompletedTaskIDs))
	for _, taskID := range dailyCompletedTaskIDs {
		dailyDone[taskID] = true
	}

	weeklyCompletionRows, err := s.q.ListTaskCompletionWeeklyCountsByTeamAndWeek(ctx, dbsqlc.ListTaskCompletionWeeklyCountsByTeamAndWeekParams{
		TeamID:    teamID,
		WeekStart: toPgDate(weekStart),
	})
	queryCount++
	if err != nil {
		return api.TaskOverviewResponse{}, err
	}
	weeklyDone := make(map[string]int, len(weeklyCompletionRows))
	for _, row := range weeklyCompletionRows {
		weeklyDone[row.TaskID] = int(row.CompletionCount)
	}

	for _, row := range tasks {
		t := taskFromUndeletedListRow(row, s.loc)
		if t.Type == api.Daily {
			daily = append(daily, api.TaskOverviewDailyTask{
				Task:           t.toAPI(),
				CompletedToday: dailyDone[t.ID],
			})
			continue
		}
		weekly = append(weekly, api.TaskOverviewWeeklyTask{
			Task:                       t.toAPI(),
			WeekCompletedCount:         weeklyDone[t.ID],
			RequiredCompletionsPerWeek: t.Required,
		})
	}

	sort.Slice(daily, func(i, j int) bool { return daily[i].Task.CreatedAt.Before(daily[j].Task.CreatedAt) })
	sort.Slice(weekly, func(i, j int) bool { return weekly[i].Task.CreatedAt.Before(weekly[j].Task.CreatedAt) })

	elapsed := int(today.Sub(weekStart).Hours()/24) + 1
	resp = api.TaskOverviewResponse{
		Month:               monthKey,
		Today:               toDate(today),
		ElapsedDaysInWeek:   elapsed,
		MonthlyPenaltyTotal: int(monthly.DailyPenaltyTotal + monthly.WeeklyPenaltyTotal),
		DailyTasks:          daily,
		WeeklyTasks:         weekly,
	}
	return resp, nil
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
		monthStart, err := monthStartFromKey(targetMonth, s.loc)
		if err != nil {
			return api.MonthlyPenaltySummary{}, err
		}
		monthEnd := monthStart.AddDate(0, 1, 0)
		asOf := time.Now().In(s.loc)
		if asOf.After(monthEnd) {
			asOf = monthEnd
		}
		effectiveRules, err := s.q.ListPenaltyRulesEffectiveAtByTeamID(ctx, dbsqlc.ListPenaltyRulesEffectiveAtByTeamIDParams{
			TeamID: teamID,
			AsOf:   toPgTimestamptz(asOf),
		})
		if err != nil {
			return api.MonthlyPenaltySummary{}, err
		}
		total := int(summary.DailyPenaltyTotal + summary.WeeklyPenaltyTotal)
		triggered = make([]string, 0, len(effectiveRules))
		for _, rule := range effectiveRules {
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
	Notes     *string
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
			Notes:     ptrFromText(row.Notes),
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
		WeekStart:   toPgDate(startOfWeek(monthStart, s.loc)),
		WeekStart_2: toPgDate(monthEnd),
	})
	if err != nil {
		return nil, err
	}
	weeklyDone := map[string]map[string]bool{}
	for _, row := range weeklyRows {
		weekStartKey := row.WeekStart.Time.In(s.loc).Format("2006-01-02")
		if weeklyDone[weekStartKey] == nil {
			weeklyDone[weekStartKey] = map[string]bool{}
		}
		weeklyDone[weekStartKey][row.TaskID] = row.CompletionCount > 0
	}

	weeklyAnchorByDay := map[string]time.Time{}
	for weekStart := startOfWeek(monthStart, s.loc); weekStart.Before(monthEnd); weekStart = weekStart.AddDate(0, 0, 7) {
		weekEnd := weekStart.AddDate(0, 0, 6)
		if monthKeyFromTime(weekEnd, s.loc) != month {
			continue
		}
		anchor := weekStart
		if anchor.Before(monthStart) {
			anchor = monthStart
		}
		weeklyAnchorByDay[anchor.Format("2006-01-02")] = weekStart
	}

	groups := []api.MonthlyTaskStatusGroup{}
	for day := monthEnd.AddDate(0, 0, -1); !day.Before(monthStart); day = day.AddDate(0, 0, -1) {
		dayStart := dateOnly(day, s.loc)
		dayEnd := dayStart.AddDate(0, 0, 1)
		dayKey := dayStart.Format("2006-01-02")
		items := []api.MonthlyTaskStatusItem{}

		for _, task := range tasks {
			completed := false
			switch task.Type {
			case api.Daily:
				if task.CreatedAt.In(s.loc).After(dayEnd.Add(-time.Nanosecond)) {
					continue
				}
				if task.DeletedAt != nil && task.DeletedAt.Before(dayEnd) {
					continue
				}
				completed = dailyDone[dayKey] != nil && dailyDone[dayKey][task.ID]
			case api.Weekly:
				weekStart, ok := weeklyAnchorByDay[dayKey]
				if !ok {
					continue
				}
				weekEnd := weekStart.AddDate(0, 0, 7)
				if task.CreatedAt.In(s.loc).After(weekEnd.Add(-time.Nanosecond)) {
					continue
				}
				if task.DeletedAt != nil && task.DeletedAt.Before(weekEnd) {
					continue
				}
				weekStartKey := weekStart.Format("2006-01-02")
				completed = weeklyDone[weekStartKey] != nil && weeklyDone[weekStartKey][task.ID]
			default:
				return nil, fmt.Errorf("unknown task type: %s", task.Type)
			}

			items = append(items, api.MonthlyTaskStatusItem{
				TaskId:        task.ID,
				Title:         task.Title,
				Notes:         task.Notes,
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
