package store

import (
	"context"
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
			done, err := s.q.HasTaskCompletion(ctx, dbsqlc.HasTaskCompletionParams{
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
	triggered, err := s.q.ListTriggeredRuleIDsByMonth(ctx, dbsqlc.ListTriggeredRuleIDsByMonthParams{
		TeamID:     teamID,
		MonthStart: summary.MonthStart,
	})
	if err != nil {
		return api.MonthlyPenaltySummary{}, err
	}
	return monthSummary{
		TeamID:          summary.TeamID,
		Month:           monthKeyFromTime(summary.MonthStart.Time, s.loc),
		DailyPenalty:    int(summary.DailyPenaltyTotal),
		WeeklyPenalty:   int(summary.WeeklyPenaltyTotal),
		IsClosed:        summary.IsClosed,
		TriggeredRuleID: triggered,
	}.toAPI(), nil
}
