package store

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (s *Store) CloseDayForUser(ctx context.Context, userID string) (api.CloseResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.CloseResponse{}, err
	}
	return s.CloseDayForTeam(ctx, teamID)
}

func (s *Store) CloseWeekForUser(ctx context.Context, userID string) (api.CloseResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.CloseResponse{}, err
	}
	return s.CloseWeekForTeam(ctx, teamID)
}

func (s *Store) CloseMonthForUser(ctx context.Context, userID string) (api.CloseResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.CloseResponse{}, err
	}
	return s.CloseMonthForTeam(ctx, teamID)
}

func (s *Store) CloseDayForTeam(ctx context.Context, teamID string) (api.CloseResponse, error) {
	now := time.Now().In(s.loc)
	if err := s.closeDayLocked(ctx, now, teamID); err != nil {
		return api.CloseResponse{}, err
	}
	return api.CloseResponse{ClosedAt: now, Month: monthKeyFromTime(now, s.loc)}, nil
}

func (s *Store) CloseWeekForTeam(ctx context.Context, teamID string) (api.CloseResponse, error) {
	now := time.Now().In(s.loc)
	if err := s.closeWeekLocked(ctx, now, teamID); err != nil {
		return api.CloseResponse{}, err
	}
	return api.CloseResponse{ClosedAt: now, Month: monthKeyFromTime(now, s.loc)}, nil
}

func (s *Store) CloseMonthForTeam(ctx context.Context, teamID string) (api.CloseResponse, error) {
	now := time.Now().In(s.loc)
	closedMonth, err := s.closeMonthLocked(ctx, now, teamID)
	if err != nil {
		return api.CloseResponse{}, err
	}
	return api.CloseResponse{ClosedAt: now, Month: closedMonth}, nil
}

func (s *Store) ListClosableTeamIDs(ctx context.Context) ([]string, error) {
	return s.q.ListTeamIDsForClose(ctx)
}

func (s *Store) autoCloseLocked(ctx context.Context, now time.Time, teamID string) error {
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

func (s *Store) closeDayLocked(ctx context.Context, now time.Time, teamID string) error {
	targetDate := dateOnly(now, s.loc).AddDate(0, 0, -1)
	rows, err := s.q.InsertCloseRun(ctx, dbsqlc.InsertCloseRunParams{
		TeamID:     teamID,
		Scope:      "close_day",
		TargetDate: toPgDate(targetDate),
	})
	if err != nil {
		return err
	}
	if rows == 0 {
		return nil
	}

	month := monthKeyFromTime(targetDate, s.loc)
	monthStart, err := monthStartFromKey(month, s.loc)
	if err != nil {
		return err
	}
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
		penRows, err := s.q.InsertTaskEvaluationDedupe(ctx, dbsqlc.InsertTaskEvaluationDedupeParams{
			TeamID:     teamID,
			Scope:      "penalty_day",
			TargetDate: toPgDate(targetDate),
			TaskID:     t.ID,
		})
		if err != nil {
			return err
		}
		if penRows == 0 {
			continue
		}
		done, err := s.q.HasTaskCompletionDaily(ctx, dbsqlc.HasTaskCompletionDailyParams{
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
				MonthStart:        toPgDate(monthStart),
				DailyPenaltyTotal: penalty32,
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Store) closeWeekLocked(ctx context.Context, now time.Time, teamID string) error {
	thisWeekStart := startOfWeek(dateOnly(now, s.loc), s.loc)
	previousWeekStart := thisWeekStart.AddDate(0, 0, -7)
	rows, err := s.q.InsertCloseRun(ctx, dbsqlc.InsertCloseRunParams{
		TeamID:     teamID,
		Scope:      "close_week",
		TargetDate: toPgDate(previousWeekStart),
	})
	if err != nil {
		return err
	}
	if rows == 0 {
		return nil
	}

	month := monthKeyFromTime(previousWeekStart, s.loc)
	monthStart, err := monthStartFromKey(month, s.loc)
	if err != nil {
		return err
	}
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
		penRows, err := s.q.InsertTaskEvaluationDedupe(ctx, dbsqlc.InsertTaskEvaluationDedupeParams{
			TeamID:     teamID,
			Scope:      "penalty_week",
			TargetDate: toPgDate(previousWeekStart),
			TaskID:     t.ID,
		})
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
				MonthStart:         toPgDate(monthStart),
				WeeklyPenaltyTotal: penalty32,
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Store) closeMonthLocked(ctx context.Context, now time.Time, teamID string) (string, error) {
	target := now.AddDate(0, -1, 0)
	month := monthKeyFromTime(target, s.loc)
	monthStart, err := monthStartFromKey(month, s.loc)
	if err != nil {
		return "", err
	}

	rows, err := s.q.InsertCloseRun(ctx, dbsqlc.InsertCloseRunParams{
		TeamID:     teamID,
		Scope:      "close_month",
		TargetDate: toPgDate(monthStart),
	})
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
		TeamID:     teamID,
		MonthStart: toPgDate(monthStart),
	}); err != nil {
		return "", err
	}
	if err := s.q.DeleteTriggeredRulesByMonth(ctx, dbsqlc.DeleteTriggeredRulesByMonthParams{
		TeamID:     teamID,
		MonthStart: toPgDate(monthStart),
	}); err != nil {
		return "", err
	}
	for _, ruleID := range triggered {
		if err := s.q.AddTriggeredRuleForMonth(ctx, dbsqlc.AddTriggeredRuleForMonthParams{
			TeamID:     teamID,
			MonthStart: toPgDate(monthStart),
			RuleID:     ruleID,
		}); err != nil {
			return "", err
		}
	}
	return month, nil
}

func (s *Store) weeklyCompletionCountLocked(ctx context.Context, taskID string, weekStart time.Time) (int, error) {
	count, err := s.q.GetTaskCompletionWeeklyCount(ctx, dbsqlc.GetTaskCompletionWeeklyCountParams{
		TaskID:    taskID,
		WeekStart: toPgDate(weekStart),
	})
	if err != nil {
		return 0, err
	}
	return int(count), nil
}

func (s *Store) ensureMonthSummaryLocked(ctx context.Context, teamID, month string) (dbsqlc.MonthlyPenaltySummary, error) {
	monthStart, err := monthStartFromKey(month, s.loc)
	if err != nil {
		return dbsqlc.MonthlyPenaltySummary{}, err
	}
	got, err := s.q.GetMonthlyPenaltySummary(ctx, dbsqlc.GetMonthlyPenaltySummaryParams{
		TeamID:     teamID,
		MonthStart: toPgDate(monthStart),
	})
	if err == nil {
		return got, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return dbsqlc.MonthlyPenaltySummary{}, err
	}
	if err := s.q.UpsertMonthlyPenaltySummary(ctx, dbsqlc.UpsertMonthlyPenaltySummaryParams{
		TeamID:             teamID,
		MonthStart:         toPgDate(monthStart),
		DailyPenaltyTotal:  0,
		WeeklyPenaltyTotal: 0,
		IsClosed:           false,
	}); err != nil {
		return dbsqlc.MonthlyPenaltySummary{}, err
	}
	return s.q.GetMonthlyPenaltySummary(ctx, dbsqlc.GetMonthlyPenaltySummaryParams{
		TeamID:     teamID,
		MonthStart: toPgDate(monthStart),
	})
}
