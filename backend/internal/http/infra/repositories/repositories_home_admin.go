package repositories

import (
	"context"

	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (r homeRepo) GetHome(ctx context.Context, userID string) (api.HomeResponse, error) {
	res, err := r.store.GetHome(ctx, userID)
	return res, mapInfraErr(err)
}

func (r homeRepo) GetMonthlySummary(ctx context.Context, userID string, month *string) (api.MonthlyPenaltySummary, error) {
	res, err := r.store.GetMonthlySummary(ctx, userID, month)
	return res, mapInfraErr(err)
}

func (r adminRepo) CloseDayForUser(ctx context.Context, userID string) (api.CloseResponse, error) {
	res, err := r.store.CloseDayForUser(ctx, userID)
	return res, mapInfraErr(err)
}

func (r adminRepo) CloseWeekForUser(ctx context.Context, userID string) (api.CloseResponse, error) {
	res, err := r.store.CloseWeekForUser(ctx, userID)
	return res, mapInfraErr(err)
}

func (r adminRepo) CloseMonthForUser(ctx context.Context, userID string) (api.CloseResponse, error) {
	res, err := r.store.CloseMonthForUser(ctx, userID)
	return res, mapInfraErr(err)
}
