package repositories

import (
	"context"

	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (r authRepo) StartGoogleAuth(ctx context.Context) (api.AuthStartResponse, error) {
	res, err := r.store.StartGoogleAuth(ctx)
	return res, mapInfraErr(err)
}

func (r authRepo) CompleteGoogleAuth(ctx context.Context, code, state, mockEmail, mockName, mockSub string) (string, string, error) {
	exchangeCode, redirectTo, err := r.store.CompleteGoogleAuth(ctx, code, state, mockEmail, mockName, mockSub)
	return exchangeCode, redirectTo, mapInfraErr(err)
}

func (r authRepo) ExchangeSession(ctx context.Context, exchangeCode string) (api.AuthSessionResponse, error) {
	res, err := r.store.ExchangeSession(ctx, exchangeCode)
	return res, mapInfraErr(err)
}

func (r authRepo) RevokeSession(ctx context.Context, token string) {
	r.store.RevokeSession(ctx, token)
}

func (r authRepo) LookupSession(ctx context.Context, token string) (string, bool) {
	return r.store.LookupSession(ctx, token)
}
