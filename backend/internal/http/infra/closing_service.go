package infra

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (s *store) closeDayForUser(ctx context.Context, userID string) (api.CloseResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.CloseResponse{}, err
	}
	now := time.Now().In(s.loc)
	if err := s.closeDayLocked(ctx, now, teamID); err != nil {
		return api.CloseResponse{}, err
	}
	return api.CloseResponse{ClosedAt: now, Month: now.Format("2006-01")}, nil
}

func (s *store) closeWeekForUser(ctx context.Context, userID string) (api.CloseResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.CloseResponse{}, err
	}
	now := time.Now().In(s.loc)
	if err := s.closeWeekLocked(ctx, now, teamID); err != nil {
		return api.CloseResponse{}, err
	}
	return api.CloseResponse{ClosedAt: now, Month: now.Format("2006-01")}, nil
}

func (s *store) closeMonthForUser(ctx context.Context, userID string) (api.CloseResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.CloseResponse{}, err
	}
	now := time.Now().In(s.loc)
	closedMonth, err := s.closeMonthLocked(ctx, now, teamID)
	if err != nil {
		return api.CloseResponse{}, err
	}
	return api.CloseResponse{ClosedAt: now, Month: closedMonth}, nil
}

func (s *store) autoCloseLocked(ctx context.Context, now time.Time, teamID string) error {
	if err := s.closeDayLocked(ctx, now, teamID); err != nil {
		return err
	}
	if err := s.closeWeekLocked(ctx, now, teamID); err != nil {
		return err
	}
	if now.Day() == 1 {
		if _, err := s.closeMonthLocked(ctx, now, teamID); err != nil {
			return err
		}
	}
	return nil
}

func (s *store) closeDayLocked(ctx context.Context, now time.Time, teamID string) error {
	targetDate := dateOnly(now, s.loc).AddDate(0, 0, -1)
	dateKey := targetDate.Format("2006-01-02")
	rows, err := s.q.InsertCloseExecutionKey(ctx, "closed|"+teamID+"|"+dateKey)
	if err != nil {
		return err
	}
	if rows == 0 {
		return nil
	}
	month := targetDate.Format("2006-01")
	if _, err := s.ensureMonthSummaryLocked(ctx, teamID, month); err != nil {
		return err
	}
	tasks, err := s.q.ListActiveTasksByTeamID(ctx, teamID)
	if err != nil {
		return err
	}
	for _, row := range tasks {
		t := taskFromActiveListRow(row, s.loc)
		if t.Type != api.Daily {
			continue
		}
		penaltyKey := fmt.Sprintf("%s|%s|%s", teamID, t.ID, dateKey)
		penRows, err := s.q.InsertCloseExecutionKey(ctx, penaltyKey)
		if err != nil {
			return err
		}
		if penRows == 0 {
			continue
		}
		done, err := s.q.HasTaskCompletion(ctx, dbsqlc.HasTaskCompletionParams{
			TaskID:     t.ID,
			TargetDate: toPgDate(targetDate),
		})
		if err != nil {
			return err
		}
		if !done {
			penalty32, err := safeInt32(t.Penalty, "daily penalty")
			if err != nil {
				return err
			}
			if err := s.q.IncrementDailyPenalty(ctx, dbsqlc.IncrementDailyPenaltyParams{
				TeamID:            teamID,
				Month:             month,
				DailyPenaltyTotal: penalty32,
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *store) closeWeekLocked(ctx context.Context, now time.Time, teamID string) error {
	thisWeekStart := startOfWeek(dateOnly(now, s.loc), s.loc)
	previousWeekStart := thisWeekStart.AddDate(0, 0, -7)
	weekKey := previousWeekStart.Format("2006-01-02")
	rows, err := s.q.InsertCloseExecutionKey(ctx, "closed|"+teamID+"|"+weekKey)
	if err != nil {
		return err
	}
	if rows == 0 {
		return nil
	}
	month := previousWeekStart.Format("2006-01")
	if _, err := s.ensureMonthSummaryLocked(ctx, teamID, month); err != nil {
		return err
	}
	tasks, err := s.q.ListActiveTasksByTeamID(ctx, teamID)
	if err != nil {
		return err
	}
	for _, row := range tasks {
		t := taskFromActiveListRow(row, s.loc)
		if t.Type != api.Weekly {
			continue
		}
		penaltyKey := fmt.Sprintf("%s|%s|%s", teamID, t.ID, weekKey)
		penRows, err := s.q.InsertCloseExecutionKey(ctx, penaltyKey)
		if err != nil {
			return err
		}
		if penRows == 0 {
			continue
		}
		count, err := s.weeklyCompletionCountLocked(ctx, t.ID, previousWeekStart)
		if err != nil {
			return err
		}
		if count < t.Required {
			penalty32, err := safeInt32(t.Penalty, "weekly penalty")
			if err != nil {
				return err
			}
			if err := s.q.IncrementWeeklyPenalty(ctx, dbsqlc.IncrementWeeklyPenaltyParams{
				TeamID:             teamID,
				Month:              month,
				WeeklyPenaltyTotal: penalty32,
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *store) closeMonthLocked(ctx context.Context, now time.Time, teamID string) (string, error) {
	target := now.AddDate(0, -1, 0)
	month := target.Format("2006-01")
	key := teamID + "|" + month
	rows, err := s.q.InsertCloseExecutionKey(ctx, key)
	if err != nil {
		return "", err
	}
	if rows == 0 {
		return month, nil
	}
	summary, err := s.ensureMonthSummaryLocked(ctx, teamID, month)
	if err != nil {
		return "", err
	}
	if summary.IsClosed {
		return month, nil
	}

	activeRules, err := s.q.ListActivePenaltyRulesByTeamID(ctx, teamID)
	if err != nil {
		return "", err
	}
	rules := make([]ruleRecord, 0, len(activeRules))
	for _, row := range activeRules {
		rules = append(rules, ruleFromDB(row, s.loc))
	}
	sort.Slice(rules, func(i, j int) bool { return rules[i].Threshold < rules[j].Threshold })
	total := int(summary.DailyPenaltyTotal + summary.WeeklyPenaltyTotal)
	triggered := []string{}
	for _, r := range rules {
		if total >= r.Threshold {
			triggered = append(triggered, r.ID)
		}
	}
	if err := s.q.CloseMonthlyPenaltySummary(ctx, dbsqlc.CloseMonthlyPenaltySummaryParams{
		TeamID:                  teamID,
		Month:                   month,
		TriggeredPenaltyRuleIds: triggered,
	}); err != nil {
		return "", err
	}
	return month, nil
}

func (s *store) weeklyCompletionCountLocked(ctx context.Context, taskID string, weekStart time.Time) (int, error) {
	weekEnd := weekStart.AddDate(0, 0, 6)
	count, err := s.q.CountTaskCompletionsInRange(ctx, dbsqlc.CountTaskCompletionsInRangeParams{
		TaskID:       taskID,
		TargetDate:   toPgDate(weekStart),
		TargetDate_2: toPgDate(weekEnd),
	})
	if err != nil {
		return 0, err
	}
	return int(count), nil
}

func (s *store) ensureMonthSummaryLocked(ctx context.Context, teamID, month string) (dbsqlc.MonthlyPenaltySummary, error) {
	got, err := s.q.GetMonthlyPenaltySummary(ctx, dbsqlc.GetMonthlyPenaltySummaryParams{
		TeamID: teamID,
		Month:  month,
	})
	if err == nil {
		return got, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return dbsqlc.MonthlyPenaltySummary{}, err
	}
	if err := s.q.UpsertMonthlyPenaltySummary(ctx, dbsqlc.UpsertMonthlyPenaltySummaryParams{
		TeamID:                  teamID,
		Month:                   month,
		DailyPenaltyTotal:       0,
		WeeklyPenaltyTotal:      0,
		IsClosed:                false,
		TriggeredPenaltyRuleIds: []string{},
	}); err != nil {
		return dbsqlc.MonthlyPenaltySummary{}, err
	}
	return s.q.GetMonthlyPenaltySummary(ctx, dbsqlc.GetMonthlyPenaltySummaryParams{
		TeamID: teamID,
		Month:  month,
	})
}
