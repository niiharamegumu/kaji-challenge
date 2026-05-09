package store

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	domainpenalty "github.com/megu/kaji-challenge/backend/internal/domain/penalty"
)

var errMonthAlreadyClosed = errors.New("monthly summary is already closed")

func (s *Store) CloseDayForUser(ctx context.Context, userID string) (model.CloseResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return model.CloseResponse{}, err
	}
	now := s.now()
	if _, err := s.runWithTeamRevisionCAS(
		ctx,
		teamID,
		"close_run",
		map[string]string{"scope": "day"},
		func(txCtx context.Context, _ *dbsqlc.Queries) error {
			processed, err := s.catchUpDayLocked(txCtx, now, teamID)
			if err != nil {
				return err
			}
			if processed == 0 {
				return errNoStateChange
			}
			return err
		},
	); err != nil {
		return model.CloseResponse{}, err
	}
	return model.CloseResponse{ClosedAt: now, Month: monthKeyFromTime(now, s.loc)}, nil
}

func (s *Store) CloseWeekForUser(ctx context.Context, userID string) (model.CloseResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return model.CloseResponse{}, err
	}
	now := s.now()
	if _, err := s.runWithTeamRevisionCAS(
		ctx,
		teamID,
		"close_run",
		map[string]string{"scope": "week"},
		func(txCtx context.Context, _ *dbsqlc.Queries) error {
			processed, err := s.catchUpWeekLocked(txCtx, now, teamID)
			if err != nil {
				return err
			}
			if processed == 0 {
				return errNoStateChange
			}
			return err
		},
	); err != nil {
		return model.CloseResponse{}, err
	}
	return model.CloseResponse{ClosedAt: now, Month: monthKeyFromTime(now, s.loc)}, nil
}

func (s *Store) CloseMonthForUser(ctx context.Context, userID string) (model.CloseResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return model.CloseResponse{}, err
	}
	now := s.now()
	processed := 0
	closedMonth := monthKeyFromTime(now, s.loc)
	if _, err := s.runWithTeamRevisionCAS(
		ctx,
		teamID,
		"close_run",
		map[string]string{"scope": "month"},
		func(txCtx context.Context, _ *dbsqlc.Queries) error {
			var err error
			processed, closedMonth, err = s.catchUpMonthLocked(txCtx, now, teamID)
			if err != nil {
				return err
			}
			if processed == 0 {
				return errNoStateChange
			}
			return err
		},
	); err != nil {
		return model.CloseResponse{}, err
	}
	return model.CloseResponse{ClosedAt: now, Month: closedMonth}, nil
}

func (s *Store) CloseDayForTeam(ctx context.Context, teamID string) (model.CloseResponse, error) {
	now := s.now()
	_, err := s.catchUpDayLocked(ctx, now, teamID)
	if err != nil {
		return model.CloseResponse{}, err
	}
	return model.CloseResponse{ClosedAt: now, Month: monthKeyFromTime(now, s.loc)}, nil
}

func (s *Store) CloseWeekForTeam(ctx context.Context, teamID string) (model.CloseResponse, error) {
	now := s.now()
	_, err := s.catchUpWeekLocked(ctx, now, teamID)
	if err != nil {
		return model.CloseResponse{}, err
	}
	return model.CloseResponse{ClosedAt: now, Month: monthKeyFromTime(now, s.loc)}, nil
}

func (s *Store) CloseMonthForTeam(ctx context.Context, teamID string) (model.CloseResponse, error) {
	now := s.now()
	_, closedMonth, err := s.catchUpMonthLocked(ctx, now, teamID)
	if err != nil {
		return model.CloseResponse{}, err
	}
	return model.CloseResponse{ClosedAt: now, Month: closedMonth}, nil
}

func (s *Store) ListClosableTeamIDs(ctx context.Context) ([]string, error) {
	return s.queries(ctx).ListTeamIDsForClose(ctx)
}

func (s *Store) PrimaryTeamID(ctx context.Context, userID string) (string, error) {
	return s.primaryTeamLocked(ctx, userID)
}

func (s *Store) RunTeamRevisionCAS(ctx context.Context, teamID, entity string, hints map[string]string, fn func(context.Context) error) error {
	_, err := s.runWithTeamRevisionCAS(ctx, teamID, entity, hints, func(txCtx context.Context, _ *dbsqlc.Queries) error {
		err := fn(txCtx)
		if err != nil && err.Error() == errNoStateChange.Error() {
			return errNoStateChange
		}
		return err
	})
	return err
}

func (s *Store) NextDayCloseTarget(ctx context.Context, teamID string) (time.Time, bool, error) {
	return s.nextDayTargetLocked(ctx, teamID)
}

func (s *Store) NextWeekCloseTarget(ctx context.Context, teamID string) (time.Time, bool, error) {
	return s.nextWeekTargetLocked(ctx, teamID)
}

func (s *Store) NextMonthCloseTarget(ctx context.Context, teamID string) (time.Time, bool, error) {
	return s.nextMonthTargetLocked(ctx, teamID)
}

func (s *Store) CloseDayTarget(ctx context.Context, teamID string, targetDate time.Time) (bool, error) {
	return s.closeDayForTargetLocked(ctx, targetDate, teamID)
}

func (s *Store) CloseWeekTarget(ctx context.Context, teamID string, weekStart time.Time) (bool, error) {
	return s.closeWeekForTargetLocked(ctx, weekStart, teamID)
}

func (s *Store) CloseMonthTarget(ctx context.Context, teamID string, monthStart time.Time) (bool, string, error) {
	return s.closeMonthForTargetLocked(ctx, monthStart, teamID)
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

	rows, err := s.queries(ctx).InsertCloseRun(ctx, dbsqlc.InsertCloseRunParams{
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
	totalPenalty, err := s.queries(ctx).SumDailyPenaltyForClose(ctx, dbsqlc.SumDailyPenaltyForCloseParams{
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
	if err := s.queries(ctx).IncrementDailyPenalty(ctx, dbsqlc.IncrementDailyPenaltyParams{
		TeamID:            teamID,
		MonthStart:        toPgDate(monthStart),
		DailyPenaltyTotal: penalty32,
	}); err != nil {
		return false, err
	}
	queryCount++
	return true, nil
}

func (s *Store) recalculateOpenMonthDailyPenaltyLocked(ctx context.Context, teamID, month string) error {
	monthStart, err := monthStartFromKey(month, s.loc)
	if err != nil {
		return err
	}
	summary, err := s.ensureMonthSummaryLocked(ctx, teamID, month)
	if err != nil {
		return err
	}
	if summary.IsClosed {
		return errMonthAlreadyClosed
	}

	monthEnd := monthStart.AddDate(0, 1, 0)
	targets, err := s.queries(ctx).ListCloseRunTargetDatesInRange(ctx, dbsqlc.ListCloseRunTargetDatesInRangeParams{
		TeamID:       teamID,
		Scope:        "close_day",
		TargetDate:   toPgDate(monthStart),
		TargetDate_2: toPgDate(monthEnd),
	})
	if err != nil {
		return err
	}

	var totalPenalty int64
	for _, target := range targets {
		targetDate := dateOnly(target.Time, s.loc)
		cutoff := targetDate.AddDate(0, 0, 1)
		dayPenalty, err := s.queries(ctx).SumDailyPenaltyForDate(ctx, dbsqlc.SumDailyPenaltyForDateParams{
			TeamID:     teamID,
			TargetDate: toPgDate(targetDate),
			CreatedAt:  toPgTimestamptz(cutoff),
		})
		if err != nil {
			return err
		}
		totalPenalty += dayPenalty
	}

	penalty32, err := safeInt64ToInt32(totalPenalty, "daily penalty")
	if err != nil {
		return err
	}
	return s.queries(ctx).SetDailyPenaltyTotal(ctx, dbsqlc.SetDailyPenaltyTotalParams{
		TeamID:            teamID,
		MonthStart:        toPgDate(monthStart),
		DailyPenaltyTotal: penalty32,
	})
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

	rows, err := s.queries(ctx).InsertCloseRun(ctx, dbsqlc.InsertCloseRunParams{
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
	totalPenalty, err := s.queries(ctx).SumWeeklyPenaltyForClose(ctx, dbsqlc.SumWeeklyPenaltyForCloseParams{
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
	if err := s.queries(ctx).IncrementWeeklyPenalty(ctx, dbsqlc.IncrementWeeklyPenaltyParams{
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
	rows, err := s.queries(ctx).InsertCloseRun(ctx, dbsqlc.InsertCloseRunParams{
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
	effectiveRules, err := s.queries(ctx).ListPenaltyRulesEffectiveAtByTeamID(ctx, dbsqlc.ListPenaltyRulesEffectiveAtByTeamIDParams{
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
	triggered := domainpenalty.TriggeredRuleIDs(total, domainPenaltyRules(rules))
	if err := s.queries(ctx).CloseMonthlyPenaltySummary(ctx, dbsqlc.CloseMonthlyPenaltySummaryParams{
		TeamID:     teamID,
		MonthStart: toPgDate(monthStart),
	}); err != nil {
		return false, "", err
	}
	if err := s.queries(ctx).DeleteTriggeredRulesByMonth(ctx, dbsqlc.DeleteTriggeredRulesByMonthParams{
		TeamID:     teamID,
		MonthStart: toPgDate(monthStart),
	}); err != nil {
		return false, "", err
	}
	for _, ruleID := range triggered {
		if err := s.queries(ctx).AddTriggeredRuleForMonth(ctx, dbsqlc.AddTriggeredRuleForMonthParams{
			TeamID:     teamID,
			MonthStart: toPgDate(monthStart),
			RuleID:     ruleID,
		}); err != nil {
			return false, "", err
		}
	}
	return true, month, nil
}

func domainPenaltyRules(rules []ruleRecord) []domainpenalty.Rule {
	items := make([]domainpenalty.Rule, 0, len(rules))
	for _, rule := range rules {
		items = append(items, domainpenalty.Rule{
			ID:        rule.ID,
			Threshold: rule.Threshold,
		})
	}
	return items
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
	latest, err := s.queries(ctx).GetLatestCloseRunTargetDate(ctx, dbsqlc.GetLatestCloseRunTargetDateParams{
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
	latest, err := s.queries(ctx).GetLatestCloseRunTargetDate(ctx, dbsqlc.GetLatestCloseRunTargetDateParams{
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
	latest, err := s.queries(ctx).GetLatestCloseRunTargetDate(ctx, dbsqlc.GetLatestCloseRunTargetDateParams{
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
	createdAt, err := s.queries(ctx).GetEarliestTaskCreatedAtByTeam(ctx, teamID)
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
	got, err := s.queries(ctx).GetMonthlyPenaltySummary(ctx, dbsqlc.GetMonthlyPenaltySummaryParams{
		TeamID:     teamID,
		MonthStart: toPgDate(monthStart),
	})
	if err == nil {
		return got, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return dbsqlc.MonthlyPenaltySummary{}, err
	}
	if err := s.queries(ctx).UpsertMonthlyPenaltySummary(ctx, dbsqlc.UpsertMonthlyPenaltySummaryParams{
		TeamID:             teamID,
		MonthStart:         toPgDate(monthStart),
		DailyPenaltyTotal:  0,
		WeeklyPenaltyTotal: 0,
		IsClosed:           false,
	}); err != nil {
		return dbsqlc.MonthlyPenaltySummary{}, err
	}
	return s.queries(ctx).GetMonthlyPenaltySummary(ctx, dbsqlc.GetMonthlyPenaltySummaryParams{
		TeamID:     teamID,
		MonthStart: toPgDate(monthStart),
	})
}
