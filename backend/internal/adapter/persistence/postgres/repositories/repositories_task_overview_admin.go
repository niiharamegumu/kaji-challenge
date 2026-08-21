package repositories

import (
	"context"
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	"github.com/megu/kaji-challenge/backend/internal/application/ports"
)

func (r taskOverviewRepo) PrimaryTeamID(ctx context.Context, userID string) (string, error) {
	res, err := r.store.PrimaryTeamID(ctx, userID)
	return res, mapInfraErr(err)
}

func (r taskOverviewRepo) Now() time.Time {
	return r.store.Now()
}

func (r taskOverviewRepo) EnsureMonthSummary(ctx context.Context, teamID, month string) (ports.MonthlyPenaltySummarySnapshot, error) {
	res, err := r.store.EnsureMonthSummary(ctx, teamID, month)
	return res, mapInfraErr(err)
}

func (r taskOverviewRepo) CleanupExpiredOneTimeReminders(ctx context.Context, teamID string) error {
	return mapInfraErr(r.store.CleanupExpiredOneTimeReminders(ctx, teamID))
}

func (r taskOverviewRepo) ListOverviewTasks(ctx context.Context, teamID string) ([]ports.OverviewTask, error) {
	res, err := r.store.ListOverviewTasks(ctx, teamID)
	return res, mapInfraErr(err)
}

func (r taskOverviewRepo) ListDailyCompletionActors(ctx context.Context, teamID string, targetDate time.Time) ([]ports.DailyCompletionActor, error) {
	res, err := r.store.ListDailyCompletionActors(ctx, teamID, targetDate)
	return res, mapInfraErr(err)
}

func (r taskOverviewRepo) ListWeeklyCompletionCounts(ctx context.Context, teamID string, weekStart time.Time) ([]ports.WeeklyCompletionCount, error) {
	res, err := r.store.ListWeeklyCompletionCounts(ctx, teamID, weekStart)
	return res, mapInfraErr(err)
}

func (r taskOverviewRepo) ListWeeklyCompletionSlots(ctx context.Context, teamID string, weekStart time.Time) ([]ports.WeeklyCompletionSlot, error) {
	res, err := r.store.ListWeeklyCompletionSlots(ctx, teamID, weekStart)
	return res, mapInfraErr(err)
}

func (r taskOverviewRepo) ListReminderRecords(ctx context.Context, teamID string) ([]ports.ReminderRecord, error) {
	res, err := r.store.ListReminderRecords(ctx, teamID)
	return res, mapInfraErr(err)
}

func (r taskOverviewRepo) ListTriggeredRuleIDs(ctx context.Context, teamID string, monthStart time.Time) ([]string, error) {
	res, err := r.store.ListTriggeredRuleIDs(ctx, teamID, monthStart)
	return res, mapInfraErr(err)
}

func (r taskOverviewRepo) ListEffectivePenaltyRules(ctx context.Context, teamID string, asOf time.Time) ([]ports.PenaltyRuleSnapshot, error) {
	res, err := r.store.ListEffectivePenaltyRules(ctx, teamID, asOf)
	return res, mapInfraErr(err)
}

func (r taskOverviewRepo) ListMonthlyStatusTasks(ctx context.Context, teamID string, monthStart, monthEnd time.Time) ([]ports.MonthlyTaskStatusRecord, error) {
	res, err := r.store.ListMonthlyStatusTasks(ctx, teamID, monthStart, monthEnd)
	return res, mapInfraErr(err)
}

func (r taskOverviewRepo) ListDailyCompletionsByMonth(ctx context.Context, teamID string, monthStart, monthEnd time.Time) ([]ports.DailyCompletionByDate, error) {
	res, err := r.store.ListDailyCompletionsByMonth(ctx, teamID, monthStart, monthEnd)
	return res, mapInfraErr(err)
}

func (r taskOverviewRepo) ListWeeklyCompletionCountsByMonth(ctx context.Context, teamID string, weekStart, monthEnd time.Time) ([]ports.WeeklyCompletionCountByWeek, error) {
	res, err := r.store.ListWeeklyCompletionCountsByMonth(ctx, teamID, weekStart, monthEnd)
	return res, mapInfraErr(err)
}

func (r taskOverviewRepo) ListWeeklyCompletionSlotsByMonth(ctx context.Context, teamID string, weekStart, monthEnd time.Time) ([]ports.WeeklyCompletionSlotByWeek, error) {
	res, err := r.store.ListWeeklyCompletionSlotsByMonth(ctx, teamID, weekStart, monthEnd)
	return res, mapInfraErr(err)
}

func (r adminRepo) ListClosableTeamIDs(ctx context.Context) ([]string, error) {
	res, err := r.store.ListClosableTeamIDs(ctx)
	return res, mapInfraErr(err)
}

func (r adminRepo) PrimaryTeamID(ctx context.Context, userID string) (string, error) {
	res, err := r.store.PrimaryTeamID(ctx, userID)
	return res, mapInfraErr(err)
}

func (r adminRepo) RunTeamRevisionCAS(ctx context.Context, teamID, entity string, hints map[string]string, fn func(context.Context) error) error {
	return mapInfraErr(r.store.RunTeamRevisionCAS(ctx, teamID, entity, hints, fn))
}

func (r adminRepo) GetMonthCloseCandidate(ctx context.Context, teamID string) (model.MonthCloseCandidateResponse, error) {
	res, err := r.store.GetMonthCloseCandidate(ctx, teamID)
	return res, mapInfraErr(err)
}

func (r adminRepo) IsMonthClosed(ctx context.Context, teamID, month string) (bool, error) {
	res, err := r.store.IsMonthClosed(ctx, teamID, month)
	return res, mapInfraErr(err)
}

func (r adminRepo) FinalizeMonth(ctx context.Context, teamID, month string) error {
	return mapInfraErr(r.store.FinalizeMonth(ctx, teamID, month))
}

func (r adminRepo) NextDayCloseTarget(ctx context.Context, teamID string) (time.Time, bool, error) {
	res, ok, err := r.store.NextDayCloseTarget(ctx, teamID)
	return res, ok, mapInfraErr(err)
}

func (r adminRepo) NextWeekCloseTarget(ctx context.Context, teamID string) (time.Time, bool, error) {
	res, ok, err := r.store.NextWeekCloseTarget(ctx, teamID)
	return res, ok, mapInfraErr(err)
}

func (r adminRepo) CloseDayTarget(ctx context.Context, teamID string, targetDate time.Time) (bool, error) {
	res, err := r.store.CloseDayTarget(ctx, teamID, targetDate)
	return res, mapInfraErr(err)
}

func (r adminRepo) CloseWeekTarget(ctx context.Context, teamID string, weekStart time.Time) (bool, error) {
	res, err := r.store.CloseWeekTarget(ctx, teamID, weekStart)
	return res, mapInfraErr(err)
}

func (r adminRepo) Now() time.Time {
	return r.store.Now()
}
