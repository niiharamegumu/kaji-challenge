package usecases

import (
	"context"

	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (u authUsecase) StartGoogleAuth(ctx context.Context) (api.AuthStartResponse, error) {
	return u.repo.StartGoogleAuth(ctx)
}

func (u authUsecase) CompleteGoogleAuth(ctx context.Context, code, state, mockEmail, mockName, mockSub string) (string, string, error) {
	return u.repo.CompleteGoogleAuth(ctx, code, state, mockEmail, mockName, mockSub)
}

func (u authUsecase) ExchangeSession(ctx context.Context, exchangeCode string) (api.AuthSessionResponse, error) {
	return u.repo.ExchangeSession(ctx, exchangeCode)
}

func (u authUsecase) RevokeSession(ctx context.Context, token string) {
	u.repo.RevokeSession(ctx, token)
}

func (u authUsecase) LookupSession(ctx context.Context, token string) (string, bool) {
	return u.repo.LookupSession(ctx, token)
}
