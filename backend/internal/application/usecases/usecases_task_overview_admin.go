package usecases

import (
	"context"

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
)

func (u taskOverviewUsecase) GetTaskOverview(ctx context.Context, userID string) (model.TaskOverviewResponse, error) {
	return u.repo.GetTaskOverview(ctx, userID)
}

func (u taskOverviewUsecase) GetMonthlySummary(ctx context.Context, userID string, month *string) (model.MonthlyPenaltySummary, error) {
	return u.repo.GetMonthlySummary(ctx, userID, month)
}

func (u adminUsecase) CloseDayForUser(ctx context.Context, userID string) (model.CloseResponse, error) {
	return u.repo.CloseDayForUser(ctx, userID)
}

func (u adminUsecase) CloseWeekForUser(ctx context.Context, userID string) (model.CloseResponse, error) {
	return u.repo.CloseWeekForUser(ctx, userID)
}

func (u adminUsecase) CloseMonthForUser(ctx context.Context, userID string) (model.CloseResponse, error) {
	return u.repo.CloseMonthForUser(ctx, userID)
}
