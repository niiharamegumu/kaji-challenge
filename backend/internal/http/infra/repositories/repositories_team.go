package repositories

import (
	"context"

	model "github.com/megu/kaji-challenge/backend/internal/http/application/model"
)

func (r teamRepo) GetMe(ctx context.Context, userID string) (model.MeResponse, error) {
	res, err := r.store.GetMe(ctx, userID)
	return res, mapInfraErr(err)
}

func (r teamRepo) PatchMeNickname(ctx context.Context, userID string, req model.UpdateNicknameRequest) (model.UpdateNicknameResponse, error) {
	res, err := r.store.PatchMeNickname(ctx, userID, req)
	return res, mapInfraErr(err)
}

func (r teamRepo) PatchMeColor(ctx context.Context, userID string, req model.UpdateColorRequest) (model.UpdateColorResponse, error) {
	res, err := r.store.PatchMeColor(ctx, userID, req)
	return res, mapInfraErr(err)
}

func (r teamRepo) CreateInvite(ctx context.Context, userID string, req model.CreateInviteRequest) (model.InviteCodeResponse, error) {
	res, err := r.store.CreateInvite(ctx, userID, req)
	return res, mapInfraErr(err)
}

func (r teamRepo) GetTeamCurrentInvite(ctx context.Context, userID string) (model.InviteCodeResponse, error) {
	res, err := r.store.GetTeamCurrentInvite(ctx, userID)
	return res, mapInfraErr(err)
}

func (r teamRepo) PatchTeamCurrent(ctx context.Context, userID string, req model.UpdateCurrentTeamRequest) (model.TeamInfoResponse, error) {
	res, err := r.store.PatchTeamCurrent(ctx, userID, req)
	return res, mapInfraErr(err)
}

func (r teamRepo) GetTeamCurrentMembers(ctx context.Context, userID string) (model.TeamMembersResponse, error) {
	res, err := r.store.GetTeamCurrentMembers(ctx, userID)
	return res, mapInfraErr(err)
}

func (r teamRepo) JoinTeam(ctx context.Context, userID, code string) (model.JoinTeamResponse, error) {
	res, err := r.store.JoinTeam(ctx, userID, code)
	return res, mapInfraErr(err)
}

func (r teamRepo) PostTeamLeave(ctx context.Context, userID string) (model.JoinTeamResponse, error) {
	res, err := r.store.PostTeamLeave(ctx, userID)
	return res, mapInfraErr(err)
}
