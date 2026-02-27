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

	dailyCompletionRows, err := s.q.ListTaskCompletionDailyByTeamAndDate(ctx, dbsqlc.ListTaskCompletionDailyByTeamAndDateParams{
		TeamID:     teamID,
		TargetDate: toPgDate(today),
	})
	queryCount++
	if err != nil {
		return api.TaskOverviewResponse{}, err
	}
	dailyDone := make(map[string]bool, len(dailyCompletionRows))
	dailyActorByTaskID := make(map[string]*api.TaskCompletionActor, len(dailyCompletionRows))
	for _, row := range dailyCompletionRows {
		dailyDone[row.TaskID] = true
		dailyActorByTaskID[row.TaskID] = taskCompletionActorPtr(row.CompletedByUserID, row.CompletedByEffectiveName, row.CompletedByColorHex)
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
	weeklySlotRows, err := s.q.ListTaskCompletionWeeklySlotsByTeamAndWeek(ctx, dbsqlc.ListTaskCompletionWeeklySlotsByTeamAndWeekParams{
		TeamID:    teamID,
		WeekStart: toPgDate(weekStart),
	})
	queryCount++
	if err != nil {
		return api.TaskOverviewResponse{}, err
	}
	weeklySlotsByTaskID := map[string]map[int]*api.TaskCompletionActor{}
	for _, row := range weeklySlotRows {
		if weeklySlotsByTaskID[row.TaskID] == nil {
			weeklySlotsByTaskID[row.TaskID] = map[int]*api.TaskCompletionActor{}
		}
		weeklySlotsByTaskID[row.TaskID][int(row.Slot)] = taskCompletionActorPtr(row.CompletedByUserID, row.CompletedByEffectiveName, row.CompletedByColorHex)
	}

	for _, row := range tasks {
		t := taskFromUndeletedListRow(row, s.loc)
		if t.Type == api.Daily {
			daily = append(daily, api.TaskOverviewDailyTask{
				Task:           t.toAPI(),
				CompletedToday: dailyDone[t.ID],
				CompletedBy:    dailyActorByTaskID[t.ID],
			})
			continue
		}
		weekly = append(weekly, api.TaskOverviewWeeklyTask{
			Task:                       t.toAPI(),
			WeekCompletedCount:         weeklyDone[t.ID],
			RequiredCompletionsPerWeek: t.Required,
			CompletionSlots:            buildCompletionSlots(t.Required, weeklySlotsByTaskID[t.ID]),
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
	Required  int
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
			Required:  int(row.RequiredCompletionsPerWeek),
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
	dailyActors := map[string]map[string]*api.TaskCompletionActor{}
	for _, row := range dailyRows {
		dateKey := row.TargetDate.Time.In(s.loc).Format("2006-01-02")
		if dailyDone[dateKey] == nil {
			dailyDone[dateKey] = map[string]bool{}
		}
		if dailyActors[dateKey] == nil {
			dailyActors[dateKey] = map[string]*api.TaskCompletionActor{}
		}
		dailyDone[dateKey][row.TaskID] = true
		dailyActors[dateKey][row.TaskID] = taskCompletionActorPtr(row.CompletedByUserID, row.CompletedByEffectiveName, row.CompletedByColorHex)
	}

	weeklyRows, err := s.q.ListTaskCompletionWeeklyByMonthAndTeam(ctx, dbsqlc.ListTaskCompletionWeeklyByMonthAndTeamParams{
		TeamID:      teamID,
		WeekStart:   toPgDate(startOfWeek(monthStart, s.loc)),
		WeekStart_2: toPgDate(monthEnd),
	})
	if err != nil {
		return nil, err
	}
	weeklyCounts := map[string]map[string]int{}
	for _, row := range weeklyRows {
		weekStartKey := row.WeekStart.Time.In(s.loc).Format("2006-01-02")
		if weeklyCounts[weekStartKey] == nil {
			weeklyCounts[weekStartKey] = map[string]int{}
		}
		weeklyCounts[weekStartKey][row.TaskID] = int(row.CompletionCount)
	}
	weeklySlotRows, err := s.q.ListTaskCompletionWeeklySlotsByMonthAndTeam(ctx, dbsqlc.ListTaskCompletionWeeklySlotsByMonthAndTeamParams{
		TeamID:      teamID,
		WeekStart:   toPgDate(startOfWeek(monthStart, s.loc)),
		WeekStart_2: toPgDate(monthEnd),
	})
	if err != nil {
		return nil, err
	}
	weeklyActors := map[string]map[string]map[int]*api.TaskCompletionActor{}
	for _, row := range weeklySlotRows {
		weekStartKey := row.WeekStart.Time.In(s.loc).Format("2006-01-02")
		if weeklyActors[weekStartKey] == nil {
			weeklyActors[weekStartKey] = map[string]map[int]*api.TaskCompletionActor{}
		}
		if weeklyActors[weekStartKey][row.TaskID] == nil {
			weeklyActors[weekStartKey][row.TaskID] = map[int]*api.TaskCompletionActor{}
		}
		weeklyActors[weekStartKey][row.TaskID][int(row.Slot)] = taskCompletionActorPtr(row.CompletedByUserID, row.CompletedByEffectiveName, row.CompletedByColorHex)
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
			var completionSlots []api.TaskCompletionSlot
			switch task.Type {
			case api.Daily:
				if task.CreatedAt.In(s.loc).After(dayEnd.Add(-time.Nanosecond)) {
					continue
				}
				if task.DeletedAt != nil && task.DeletedAt.Before(dayEnd) {
					continue
				}
				completed = dailyDone[dayKey] != nil && dailyDone[dayKey][task.ID]
				completionSlots = buildCompletionSlots(1, map[int]*api.TaskCompletionActor{
					1: dailyActors[dayKey][task.ID],
				})
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
				completed = weeklyCounts[weekStartKey] != nil && weeklyCounts[weekStartKey][task.ID] >= task.Required
				completionSlots = buildCompletionSlots(task.Required, weeklyActors[weekStartKey][task.ID])
			default:
				return nil, fmt.Errorf("unknown task type: %s", task.Type)
			}

			items = append(items, api.MonthlyTaskStatusItem{
				TaskId:          task.ID,
				Title:           task.Title,
				Notes:           task.Notes,
				Type:            task.Type,
				PenaltyPoints:   task.Penalty,
				Completed:       completed,
				IsDeleted:       task.DeletedAt != nil,
				CompletionSlots: completionSlots,
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

func taskCompletionActorPtr(userIDRaw interface{}, effectiveName string, colorHexRaw interface{}) *api.TaskCompletionActor {
	userID := ptrFromAny(userIDRaw)
	if userID == nil {
		return nil
	}
	return &api.TaskCompletionActor{
		UserId:        *userID,
		EffectiveName: effectiveName,
		ColorHex:      ptrFromAny(colorHexRaw),
	}
}

func buildCompletionSlots(required int, actorsBySlot map[int]*api.TaskCompletionActor) []api.TaskCompletionSlot {
	if required < 1 {
		required = 1
	}
	slots := make([]api.TaskCompletionSlot, 0, required)
	for idx := 1; idx <= required; idx++ {
		slots = append(slots, api.TaskCompletionSlot{
			Slot:  idx,
			Actor: actorsBySlot[idx],
		})
	}
	return slots
}
