package usecases

import (
	"context"

	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (u homeUsecase) GetHome(ctx context.Context, userID string) (api.HomeResponse, error) {
	return u.repo.GetHome(ctx, userID)
}

func (u homeUsecase) GetMonthlySummary(ctx context.Context, userID string, month *string) (api.MonthlyPenaltySummary, error) {
	return u.repo.GetMonthlySummary(ctx, userID, month)
}

func (u adminUsecase) CloseDayForUser(ctx context.Context, userID string) (api.CloseResponse, error) {
	return u.repo.CloseDayForUser(ctx, userID)
}

func (u adminUsecase) CloseWeekForUser(ctx context.Context, userID string) (api.CloseResponse, error) {
	return u.repo.CloseWeekForUser(ctx, userID)
}

func (u adminUsecase) CloseMonthForUser(ctx context.Context, userID string) (api.CloseResponse, error) {
	return u.repo.CloseMonthForUser(ctx, userID)
}
