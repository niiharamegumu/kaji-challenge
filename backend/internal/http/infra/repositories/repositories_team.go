package repositories

import (
	"context"

	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (r teamRepo) GetMe(ctx context.Context, userID string) (api.MeResponse, error) {
	res, err := r.store.GetMe(ctx, userID)
	return res, mapInfraErr(err)
}

func (r teamRepo) CreateInvite(ctx context.Context, userID string, req api.CreateInviteRequest) (api.InviteCodeResponse, error) {
	res, err := r.store.CreateInvite(ctx, userID, req)
	return res, mapInfraErr(err)
}

func (r teamRepo) JoinTeam(ctx context.Context, userID, code string) (api.JoinTeamResponse, error) {
	res, err := r.store.JoinTeam(ctx, userID, code)
	return res, mapInfraErr(err)
}
