package usecases

import (
	"context"

	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (u teamUsecase) GetMe(ctx context.Context, userID string) (api.MeResponse, error) {
	return u.repo.GetMe(ctx, userID)
}

func (u teamUsecase) PatchMeNickname(ctx context.Context, userID string, req api.UpdateNicknameRequest) (api.UpdateNicknameResponse, error) {
	return u.repo.PatchMeNickname(ctx, userID, req)
}

func (u teamUsecase) CreateInvite(ctx context.Context, userID string, req api.CreateInviteRequest) (api.InviteCodeResponse, error) {
	return u.repo.CreateInvite(ctx, userID, req)
}

func (u teamUsecase) GetTeamCurrentInvite(ctx context.Context, userID string) (api.InviteCodeResponse, error) {
	return u.repo.GetTeamCurrentInvite(ctx, userID)
}

func (u teamUsecase) PatchTeamCurrent(ctx context.Context, userID string, req api.UpdateCurrentTeamRequest) (api.TeamInfoResponse, error) {
	return u.repo.PatchTeamCurrent(ctx, userID, req)
}

func (u teamUsecase) GetTeamCurrentMembers(ctx context.Context, userID string) (api.TeamMembersResponse, error) {
	return u.repo.GetTeamCurrentMembers(ctx, userID)
}

func (u teamUsecase) JoinTeam(ctx context.Context, userID, code string) (api.JoinTeamResponse, error) {
	return u.repo.JoinTeam(ctx, userID, code)
}

func (u teamUsecase) PostTeamLeave(ctx context.Context, userID string) (api.JoinTeamResponse, error) {
	return u.repo.PostTeamLeave(ctx, userID)
}
