package repositories

import (
	"context"
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
)

func (r taskOverviewRepo) GetTaskOverview(ctx context.Context, userID string) (model.TaskOverviewResponse, error) {
	res, err := r.store.GetTaskOverview(ctx, userID)
	return res, mapInfraErr(err)
}

func (r taskOverviewRepo) GetMonthlySummary(ctx context.Context, userID string, month *string) (model.MonthlyPenaltySummary, error) {
	res, err := r.store.GetMonthlySummary(ctx, userID, month)
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

func (r adminRepo) NextDayCloseTarget(ctx context.Context, teamID string) (time.Time, bool, error) {
	res, ok, err := r.store.NextDayCloseTarget(ctx, teamID)
	return res, ok, mapInfraErr(err)
}

func (r adminRepo) NextWeekCloseTarget(ctx context.Context, teamID string) (time.Time, bool, error) {
	res, ok, err := r.store.NextWeekCloseTarget(ctx, teamID)
	return res, ok, mapInfraErr(err)
}

func (r adminRepo) NextMonthCloseTarget(ctx context.Context, teamID string) (time.Time, bool, error) {
	res, ok, err := r.store.NextMonthCloseTarget(ctx, teamID)
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

func (r adminRepo) CloseMonthTarget(ctx context.Context, teamID string, monthStart time.Time) (bool, string, error) {
	res, month, err := r.store.CloseMonthTarget(ctx, teamID, monthStart)
	return res, month, mapInfraErr(err)
}

func (r adminRepo) Now() time.Time {
	return r.store.Now()
}

func (r adminRepo) CloseDayForUser(ctx context.Context, userID string) (model.CloseResponse, error) {
	res, err := r.store.CloseDayForUser(ctx, userID)
	return res, mapInfraErr(err)
}

func (r adminRepo) CloseWeekForUser(ctx context.Context, userID string) (model.CloseResponse, error) {
	res, err := r.store.CloseWeekForUser(ctx, userID)
	return res, mapInfraErr(err)
}

func (r adminRepo) CloseMonthForUser(ctx context.Context, userID string) (model.CloseResponse, error) {
	res, err := r.store.CloseMonthForUser(ctx, userID)
	return res, mapInfraErr(err)
}

func (r adminRepo) CloseDayForTeam(ctx context.Context, teamID string) (model.CloseResponse, error) {
	res, err := r.store.CloseDayForTeam(ctx, teamID)
	return res, mapInfraErr(err)
}

func (r adminRepo) CloseWeekForTeam(ctx context.Context, teamID string) (model.CloseResponse, error) {
	res, err := r.store.CloseWeekForTeam(ctx, teamID)
	return res, mapInfraErr(err)
}

func (r adminRepo) CloseMonthForTeam(ctx context.Context, teamID string) (model.CloseResponse, error) {
	res, err := r.store.CloseMonthForTeam(ctx, teamID)
	return res, mapInfraErr(err)
}
