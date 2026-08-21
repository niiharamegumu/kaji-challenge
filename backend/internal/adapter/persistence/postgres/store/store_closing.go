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

func (s *Store) CloseDayTarget(ctx context.Context, teamID string, targetDate time.Time) (bool, error) {
	var didRun bool
	err := s.runInTransaction(ctx, func(txCtx context.Context) error {
		var err error
		didRun, err = s.closeDayForTargetLocked(txCtx, targetDate, teamID)
		return err
	})
	return didRun, err
}

func (s *Store) CloseWeekTarget(ctx context.Context, teamID string, weekStart time.Time) (bool, error) {
	var didRun bool
	err := s.runInTransaction(ctx, func(txCtx context.Context) error {
		var err error
		didRun, err = s.closeWeekForTargetLocked(txCtx, weekStart, teamID)
		return err
	})
	return didRun, err
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
	return s.recalculateMonthLocked(ctx, teamID, month, s.isPastMonth(month))
}

func (s *Store) recalculateOpenMonthWeeklyPenaltyLocked(ctx context.Context, teamID, month string) error {
	return s.recalculateMonthLocked(ctx, teamID, month, s.isPastMonth(month))
}

func (s *Store) isPastMonth(month string) bool {
	return month < monthKeyFromTime(s.now(), s.loc)
}

func (s *Store) recalculateMonthLocked(ctx context.Context, teamID, month string, ensureCoverage bool) error {
	monthStart, err := monthStartFromKey(month, s.loc)
	if err != nil {
		return err
	}
	summary, err := s.ensureMonthSummaryLocked(ctx, teamID, month)
	if err != nil {
		return err
	}
	monthEnd := monthStart.AddDate(0, 1, 0)
	q := s.queries(ctx)
	if ensureCoverage {
		if err := q.InsertDayCloseRunsForMonth(ctx, dbsqlc.InsertDayCloseRunsForMonthParams{
			TeamID:     teamID,
			MonthStart: toPgDate(monthStart),
			MonthEnd:   toPgDate(monthEnd),
		}); err != nil {
			return err
		}
		if err := q.InsertWeekCloseRunsForMonth(ctx, dbsqlc.InsertWeekCloseRunsForMonthParams{
			TeamID:         teamID,
			FirstWeekStart: toPgDate(startOfWeek(monthStart, s.loc)),
			MonthEnd:       toPgDate(monthEnd),
			MonthStart:     toPgDate(monthStart),
		}); err != nil {
			return err
		}
	}
	daily, err := q.SumDailyPenaltyForMonth(ctx, dbsqlc.SumDailyPenaltyForMonthParams{
		TeamID:       teamID,
		TargetDate:   toPgDate(monthStart),
		TargetDate_2: toPgDate(monthEnd),
	})
	if err != nil {
		return err
	}
	weekly, err := q.SumWeeklyPenaltyForMonth(ctx, dbsqlc.SumWeeklyPenaltyForMonthParams{
		TeamID:       teamID,
		TargetDate:   toPgDate(monthStart),
		TargetDate_2: toPgDate(monthEnd),
	})
	if err != nil {
		return err
	}
	daily32, err := safeInt64ToInt32(daily, "daily penalty")
	if err != nil {
		return err
	}
	weekly32, err := safeInt64ToInt32(weekly, "weekly penalty")
	if err != nil {
		return err
	}
	if err := q.SetMonthPenaltyTotals(ctx, dbsqlc.SetMonthPenaltyTotalsParams{
		TeamID:             teamID,
		MonthStart:         toPgDate(monthStart),
		DailyPenaltyTotal:  daily32,
		WeeklyPenaltyTotal: weekly32,
	}); err != nil {
		return err
	}
	if summary.IsClosed {
		return s.replaceTriggeredRulesLocked(ctx, teamID, monthStart, int(daily32+weekly32))
	}
	return nil
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

func (s *Store) GetMonthCloseCandidate(ctx context.Context, teamID string) (model.MonthCloseCandidateResponse, error) {
	currentMonthStart := time.Date(s.now().In(s.loc).Year(), s.now().In(s.loc).Month(), 1, 0, 0, 0, 0, s.loc)
	row, err := s.queries(ctx).FindOldestMonthCloseCandidate(ctx, dbsqlc.FindOldestMonthCloseCandidateParams{
		TeamID:            teamID,
		CurrentMonthStart: toPgDate(currentMonthStart),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return model.MonthCloseCandidateResponse{Candidate: nil, PendingMonthCount: 0}, nil
	}
	if err != nil {
		return model.MonthCloseCandidateResponse{}, err
	}
	monthStart := dateOnly(row.MonthStart.Time, s.loc)
	monthEnd := monthStart.AddDate(0, 1, 0)
	lastDay := monthEnd.AddDate(0, 0, -1)
	weeklyThrough := lastDay.AddDate(0, 0, -int(lastDay.Weekday()))
	return model.MonthCloseCandidateResponse{
		Candidate: &model.MonthCloseCandidate{
			Month:             monthKeyFromTime(monthStart, s.loc),
			DailyThroughDate:  toDate(lastDay),
			WeeklyThroughDate: toDate(weeklyThrough),
		},
		PendingMonthCount: int(row.PendingMonthCount),
	}, nil
}

func (s *Store) IsMonthClosed(ctx context.Context, teamID, month string) (bool, error) {
	monthStart, err := monthStartFromKey(month, s.loc)
	if err != nil {
		return false, err
	}
	closed, err := s.queries(ctx).GetMonthCloseState(ctx, dbsqlc.GetMonthCloseStateParams{
		TeamID:     teamID,
		MonthStart: toPgDate(monthStart),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return closed, err
}

func (s *Store) FinalizeMonth(ctx context.Context, teamID, month string) error {
	monthStart, err := monthStartFromKey(month, s.loc)
	if err != nil {
		return err
	}
	if err := s.recalculateMonthLocked(ctx, teamID, month, true); err != nil {
		return err
	}
	summary, err := s.ensureMonthSummaryLocked(ctx, teamID, month)
	if err != nil {
		return err
	}
	if err := s.replaceTriggeredRulesLocked(ctx, teamID, monthStart, int(summary.DailyPenaltyTotal+summary.WeeklyPenaltyTotal)); err != nil {
		return err
	}
	return s.queries(ctx).CloseMonthlyPenaltySummary(ctx, dbsqlc.CloseMonthlyPenaltySummaryParams{
		TeamID:     teamID,
		MonthStart: toPgDate(monthStart),
	})
}

func (s *Store) replaceTriggeredRulesLocked(ctx context.Context, teamID string, monthStart time.Time, total int) error {
	q := s.queries(ctx)
	effectiveRules, err := q.ListUndeletedPenaltyRulesByTeamID(ctx, teamID)
	if err != nil {
		return err
	}
	rules := make([]ruleRecord, 0, len(effectiveRules))
	for _, row := range effectiveRules {
		rules = append(rules, ruleFromDB(row, s.loc))
	}
	sort.Slice(rules, func(i, j int) bool { return rules[i].Threshold < rules[j].Threshold })
	if err := q.DeleteTriggeredRulesByMonth(ctx, dbsqlc.DeleteTriggeredRulesByMonthParams{
		TeamID:     teamID,
		MonthStart: toPgDate(monthStart),
	}); err != nil {
		return err
	}
	for _, ruleID := range domainpenalty.TriggeredRuleIDs(total, domainPenaltyRules(rules)) {
		if err := q.AddTriggeredRuleForMonth(ctx, dbsqlc.AddTriggeredRuleForMonthParams{
			TeamID:     teamID,
			MonthStart: toPgDate(monthStart),
			RuleID:     ruleID,
		}); err != nil {
			return err
		}
	}
	return nil
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
