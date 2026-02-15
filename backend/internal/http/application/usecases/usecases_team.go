package usecases

import (
	"context"

	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (u teamUsecase) GetMe(ctx context.Context, userID string) (api.MeResponse, error) {
	return u.repo.GetMe(ctx, userID)
}

func (u teamUsecase) CreateInvite(ctx context.Context, userID string, req api.CreateInviteRequest) (api.InviteCodeResponse, error) {
	return u.repo.CreateInvite(ctx, userID, req)
}

func (u teamUsecase) JoinTeam(ctx context.Context, userID, code string) (api.JoinTeamResponse, error) {
	return u.repo.JoinTeam(ctx, userID, code)
}
