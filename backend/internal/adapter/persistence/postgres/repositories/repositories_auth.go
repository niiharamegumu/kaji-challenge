package repositories

import (
	"context"
	"time"

	"github.com/megu/kaji-challenge/backend/internal/application/ports"
)

func (r authRepo) CreateAuthRequest(ctx context.Context, state, nonce, codeVerifier string, expiresAt time.Time) error {
	return mapInfraErr(r.store.CreateAuthRequest(ctx, state, nonce, codeVerifier, expiresAt))
}

func (r authRepo) ConsumeAuthRequest(ctx context.Context, state string, now time.Time) (ports.AuthRequest, error) {
	res, err := r.store.ConsumeAuthRequest(ctx, state, now)
	return res, mapInfraErr(err)
}

func (r authRepo) GetOrCreateAuthUser(ctx context.Context, issuer, subject, email, name string) (ports.AuthUserResult, error) {
	res, err := r.store.GetOrCreateAuthUser(ctx, issuer, subject, email, name)
	return res, mapInfraErr(err)
}

func (r authRepo) CreateExchangeCode(ctx context.Context, userID string, expiresAt time.Time) (string, error) {
	res, err := r.store.CreateExchangeCode(ctx, userID, expiresAt)
	return res, mapInfraErr(err)
}

func (r authRepo) ExchangeSession(ctx context.Context, exchangeCode string) (ports.AuthSession, error) {
	res, err := r.store.ExchangeSession(ctx, exchangeCode)
	return res, mapInfraErr(err)
}

func (r authRepo) RevokeSession(ctx context.Context, token string) {
	r.store.RevokeSession(ctx, token)
}

func (r authRepo) LookupSession(ctx context.Context, token string) (string, bool) {
	return r.store.LookupSession(ctx, token)
}
