package usecases

import (
	"context"

	model "github.com/megu/kaji-challenge/backend/internal/http/application/model"
)

func (u teamUsecase) GetMe(ctx context.Context, userID string) (model.MeResponse, error) {
	return u.repo.GetMe(ctx, userID)
}

func (u teamUsecase) PatchMeNickname(ctx context.Context, userID string, req model.UpdateNicknameRequest) (model.UpdateNicknameResponse, error) {
	return u.repo.PatchMeNickname(ctx, userID, req)
}

func (u teamUsecase) PatchMeColor(ctx context.Context, userID string, req model.UpdateColorRequest) (model.UpdateColorResponse, error) {
	return u.repo.PatchMeColor(ctx, userID, req)
}

func (u teamUsecase) CreateInvite(ctx context.Context, userID string, req model.CreateInviteRequest) (model.InviteCodeResponse, error) {
	return u.repo.CreateInvite(ctx, userID, req)
}

func (u teamUsecase) GetTeamCurrentInvite(ctx context.Context, userID string) (model.InviteCodeResponse, error) {
	return u.repo.GetTeamCurrentInvite(ctx, userID)
}

func (u teamUsecase) PatchTeamCurrent(ctx context.Context, userID string, req model.UpdateCurrentTeamRequest) (model.TeamInfoResponse, error) {
	return u.repo.PatchTeamCurrent(ctx, userID, req)
}

func (u teamUsecase) GetTeamCurrentMembers(ctx context.Context, userID string) (model.TeamMembersResponse, error) {
	return u.repo.GetTeamCurrentMembers(ctx, userID)
}

func (u teamUsecase) JoinTeam(ctx context.Context, userID, code string) (model.JoinTeamResponse, error) {
	return u.repo.JoinTeam(ctx, userID, code)
}

func (u teamUsecase) PostTeamLeave(ctx context.Context, userID string) (model.JoinTeamResponse, error) {
	return u.repo.PostTeamLeave(ctx, userID)
}
