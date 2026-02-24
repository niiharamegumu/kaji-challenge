package store

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

var errMonthAlreadyClosed = errors.New("monthly summary is already closed")

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
	if _, err := s.catchUpDayLocked(ctx, now, teamID); err != nil {
		return api.CloseResponse{}, err
	}
	return api.CloseResponse{ClosedAt: now, Month: monthKeyFromTime(now, s.loc)}, nil
}

func (s *Store) CloseWeekForTeam(ctx context.Context, teamID string) (api.CloseResponse, error) {
	now := time.Now().In(s.loc)
	if _, err := s.catchUpWeekLocked(ctx, now, teamID); err != nil {
		return api.CloseResponse{}, err
	}
	return api.CloseResponse{ClosedAt: now, Month: monthKeyFromTime(now, s.loc)}, nil
}

func (s *Store) CloseMonthForTeam(ctx context.Context, teamID string) (api.CloseResponse, error) {
	now := time.Now().In(s.loc)
	_, closedMonth, err := s.catchUpMonthLocked(ctx, now, teamID)
	if err != nil {
		return api.CloseResponse{}, err
	}
	return api.CloseResponse{ClosedAt: now, Month: closedMonth}, nil
}

func (s *Store) ListClosableTeamIDs(ctx context.Context) ([]string, error) {
	return s.q.ListTeamIDsForClose(ctx)
}

func (s *Store) closeDayForTargetLocked(ctx context.Context, targetDate time.Time, teamID string) (bool, error) {
	startedAt := time.Now()
	queryCount := 0
	defer func() {
		s.logSQLPerformance("close_day_for_target", startedAt, queryCount, fmt.Sprintf("team_id=%s target_date=%s", teamID, targetDate.Format("2006-01-02")))
	}()

	month := monthKeyFromTime(targetDate, s.loc)
	summary, err := s.ensureMonthSummaryLocked(ctx, teamID, month)
	if err != nil {
		return false, err
	}
	if summary.IsClosed {
		return false, fmt.Errorf("%w: scope=day month=%s", errMonthAlreadyClosed, month)
	}

	rows, err := s.q.InsertCloseRun(ctx, dbsqlc.InsertCloseRunParams{
		TeamID:     teamID,
		Scope:      "close_day",
		TargetDate: toPgDate(targetDate),
	})
	queryCount++
	if err != nil {
		return false, err
	}
	if rows == 0 {
		return false, nil
	}

	monthStart, err := monthStartFromKey(month, s.loc)
	if err != nil {
		return false, err
	}
	cutoff := dateOnly(targetDate, s.loc).AddDate(0, 0, 1)
	totalPenalty, err := s.q.SumDailyPenaltyForClose(ctx, dbsqlc.SumDailyPenaltyForCloseParams{
		TeamID:     teamID,
		TargetDate: toPgDate(targetDate),
		CreatedAt:  toPgTimestamptz(cutoff),
	})
	queryCount++
	if err != nil {
		return false, err
	}

	if totalPenalty <= 0 {
		return true, nil
	}
	penalty32, err := safeInt64ToInt32(totalPenalty, "daily penalty")
	if err != nil {
		return false, err
	}
	if err := s.q.IncrementDailyPenalty(ctx, dbsqlc.IncrementDailyPenaltyParams{
		TeamID:            teamID,
		MonthStart:        toPgDate(monthStart),
		DailyPenaltyTotal: penalty32,
	}); err != nil {
		return false, err
	}
	queryCount++
	return true, nil
}

func (s *Store) closeWeekForTargetLocked(ctx context.Context, previousWeekStart time.Time, teamID string) (bool, error) {
	startedAt := time.Now()
	queryCount := 0
	defer func() {
		s.logSQLPerformance("close_week_for_target", startedAt, queryCount, fmt.Sprintf("team_id=%s week_start=%s", teamID, previousWeekStart.Format("2006-01-02")))
	}()

	weekEnd := dateOnly(previousWeekStart, s.loc).AddDate(0, 0, 6)
	month := monthKeyFromTime(weekEnd, s.loc)
	summary, err := s.ensureMonthSummaryLocked(ctx, teamID, month)
	if err != nil {
		return false, err
	}
	if summary.IsClosed {
		return false, fmt.Errorf("%w: scope=week month=%s", errMonthAlreadyClosed, month)
	}

	rows, err := s.q.InsertCloseRun(ctx, dbsqlc.InsertCloseRunParams{
		TeamID:     teamID,
		Scope:      "close_week",
		TargetDate: toPgDate(previousWeekStart),
	})
	queryCount++
	if err != nil {
		return false, err
	}
	if rows == 0 {
		return false, nil
	}

	monthStart, err := monthStartFromKey(month, s.loc)
	if err != nil {
		return false, err
	}
	cutoff := dateOnly(previousWeekStart, s.loc).AddDate(0, 0, 7)
	totalPenalty, err := s.q.SumWeeklyPenaltyForClose(ctx, dbsqlc.SumWeeklyPenaltyForCloseParams{
		TeamID:    teamID,
		WeekStart: toPgDate(previousWeekStart),
		CreatedAt: toPgTimestamptz(cutoff),
	})
	queryCount++
	if err != nil {
		return false, err
	}

	if totalPenalty <= 0 {
		return true, nil
	}
	penalty32, err := safeInt64ToInt32(totalPenalty, "weekly penalty")
	if err != nil {
		return false, err
	}
	if err := s.q.IncrementWeeklyPenalty(ctx, dbsqlc.IncrementWeeklyPenaltyParams{
		TeamID:             teamID,
		MonthStart:         toPgDate(monthStart),
		WeeklyPenaltyTotal: penalty32,
	}); err != nil {
		return false, err
	}
	queryCount++
	return true, nil
}

func (s *Store) closeMonthForTargetLocked(ctx context.Context, monthStart time.Time, teamID string) (bool, string, error) {
	month := monthKeyFromTime(monthStart, s.loc)
	rows, err := s.q.InsertCloseRun(ctx, dbsqlc.InsertCloseRunParams{
		TeamID:     teamID,
		Scope:      "close_month",
		TargetDate: toPgDate(monthStart),
	})
	if err != nil {
		return false, "", err
	}
	if rows == 0 {
		return false, month, nil
	}

	summary, err := s.ensureMonthSummaryLocked(ctx, teamID, month)
	if err != nil {
		return false, "", err
	}
	if summary.IsClosed {
		return true, month, nil
	}

	asOf := monthStart.AddDate(0, 1, 0)
	effectiveRules, err := s.q.ListPenaltyRulesEffectiveAtByTeamID(ctx, dbsqlc.ListPenaltyRulesEffectiveAtByTeamIDParams{
		TeamID: teamID,
		AsOf:   toPgTimestamptz(asOf),
	})
	if err != nil {
		return false, "", err
	}
	rules := make([]ruleRecord, 0, len(effectiveRules))
	for _, row := range effectiveRules {
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
		return false, "", err
	}
	if err := s.q.DeleteTriggeredRulesByMonth(ctx, dbsqlc.DeleteTriggeredRulesByMonthParams{
		TeamID:     teamID,
		MonthStart: toPgDate(monthStart),
	}); err != nil {
		return false, "", err
	}
	for _, ruleID := range triggered {
		if err := s.q.AddTriggeredRuleForMonth(ctx, dbsqlc.AddTriggeredRuleForMonthParams{
			TeamID:     teamID,
			MonthStart: toPgDate(monthStart),
			RuleID:     ruleID,
		}); err != nil {
			return false, "", err
		}
	}
	return true, month, nil
}

func (s *Store) catchUpDayLocked(ctx context.Context, now time.Time, teamID string) (int, error) {
	end := dateOnly(now, s.loc).AddDate(0, 0, -1)
	start, ok, err := s.nextDayTargetLocked(ctx, teamID)
	if err != nil {
		return 0, err
	}
	if !ok || start.After(end) {
		return 0, nil
	}
	processed := 0
	for target := start; !target.After(end); target = target.AddDate(0, 0, 1) {
		didRun, err := s.closeDayForTargetLocked(ctx, target, teamID)
		if err != nil {
			return processed, err
		}
		if didRun {
			processed++
		}
	}
	return processed, nil
}

func (s *Store) catchUpWeekLocked(ctx context.Context, now time.Time, teamID string) (int, error) {
	thisWeekStart := startOfWeek(dateOnly(now, s.loc), s.loc)
	end := thisWeekStart.AddDate(0, 0, -7)
	start, ok, err := s.nextWeekTargetLocked(ctx, teamID)
	if err != nil {
		return 0, err
	}
	if !ok || start.After(end) {
		return 0, nil
	}
	processed := 0
	for target := start; !target.After(end); target = target.AddDate(0, 0, 7) {
		didRun, err := s.closeWeekForTargetLocked(ctx, target, teamID)
		if err != nil {
			return processed, err
		}
		if didRun {
			processed++
		}
	}
	return processed, nil
}

func (s *Store) catchUpMonthLocked(ctx context.Context, now time.Time, teamID string) (int, string, error) {
	monthStartCurrent := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, s.loc)
	end := monthStartCurrent.AddDate(0, -1, 0)
	start, ok, err := s.nextMonthTargetLocked(ctx, teamID)
	if err != nil {
		return 0, "", err
	}
	lastMonth := monthKeyFromTime(end, s.loc)
	if !ok || start.After(end) {
		return 0, lastMonth, nil
	}
	processed := 0
	for target := start; !target.After(end); target = target.AddDate(0, 1, 0) {
		didRun, month, err := s.closeMonthForTargetLocked(ctx, target, teamID)
		if err != nil {
			return processed, "", err
		}
		lastMonth = month
		if didRun {
			processed++
		}
	}
	return processed, lastMonth, nil
}

func (s *Store) nextDayTargetLocked(ctx context.Context, teamID string) (time.Time, bool, error) {
	latest, err := s.q.GetLatestCloseRunTargetDate(ctx, dbsqlc.GetLatestCloseRunTargetDateParams{
		TeamID: teamID,
		Scope:  "close_day",
	})
	if err != nil {
		return time.Time{}, false, err
	}
	if latest.Valid {
		return dateOnly(latest.Time, s.loc).AddDate(0, 0, 1), true, nil
	}
	seed, ok, err := s.seedTargetDateLocked(ctx, teamID)
	if err != nil {
		return time.Time{}, false, err
	}
	if !ok {
		return time.Time{}, false, nil
	}
	return seed, true, nil
}

func (s *Store) nextWeekTargetLocked(ctx context.Context, teamID string) (time.Time, bool, error) {
	latest, err := s.q.GetLatestCloseRunTargetDate(ctx, dbsqlc.GetLatestCloseRunTargetDateParams{
		TeamID: teamID,
		Scope:  "close_week",
	})
	if err != nil {
		return time.Time{}, false, err
	}
	if latest.Valid {
		return dateOnly(latest.Time, s.loc).AddDate(0, 0, 7), true, nil
	}
	seed, ok, err := s.seedTargetDateLocked(ctx, teamID)
	if err != nil {
		return time.Time{}, false, err
	}
	if !ok {
		return time.Time{}, false, nil
	}
	return startOfWeek(seed, s.loc), true, nil
}

func (s *Store) nextMonthTargetLocked(ctx context.Context, teamID string) (time.Time, bool, error) {
	latest, err := s.q.GetLatestCloseRunTargetDate(ctx, dbsqlc.GetLatestCloseRunTargetDateParams{
		TeamID: teamID,
		Scope:  "close_month",
	})
	if err != nil {
		return time.Time{}, false, err
	}
	if latest.Valid {
		latestMonth := dateOnly(latest.Time, s.loc)
		return time.Date(latestMonth.Year(), latestMonth.Month(), 1, 0, 0, 0, 0, s.loc).AddDate(0, 1, 0), true, nil
	}
	seed, ok, err := s.seedTargetDateLocked(ctx, teamID)
	if err != nil {
		return time.Time{}, false, err
	}
	if !ok {
		return time.Time{}, false, nil
	}
	return time.Date(seed.Year(), seed.Month(), 1, 0, 0, 0, 0, s.loc), true, nil
}

func (s *Store) seedTargetDateLocked(ctx context.Context, teamID string) (time.Time, bool, error) {
	createdAt, err := s.q.GetEarliestTaskCreatedAtByTeam(ctx, teamID)
	if err != nil {
		return time.Time{}, false, err
	}
	if !createdAt.Valid {
		return time.Time{}, false, nil
	}
	return dateOnly(createdAt.Time, s.loc), true, nil
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
