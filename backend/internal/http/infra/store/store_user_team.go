package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (s *Store) getOrCreateUserLocked(ctx context.Context, email, displayName string) (string, userRecord, error) {
	now := time.Now().In(s.loc)
	row, err := s.q.GetUserByEmail(ctx, email)
	if err == nil {
		if displayName != "" && row.DisplayName != displayName {
			if err := s.q.UpdateUserDisplayName(ctx, dbsqlc.UpdateUserDisplayNameParams{
				ID:          row.ID,
				DisplayName: displayName,
			}); err != nil {
				return "", userRecord{}, err
			}
			row.DisplayName = displayName
		}
		return row.ID, userRecord{ID: row.ID, Email: row.Email, Name: row.DisplayName, CreatedAt: row.CreatedAt.Time.In(s.loc)}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", userRecord{}, err
	}
	userID := s.nextID("usr")
	teamID := s.nextID("team")
	user := userRecord{ID: userID, Email: email, Name: displayName, CreatedAt: now}
	if err := s.q.CreateUser(ctx, dbsqlc.CreateUserParams{
		ID:          user.ID,
		Email:       user.Email,
		DisplayName: user.Name,
		CreatedAt:   toPgTimestamptz(user.CreatedAt),
	}); err != nil {
		return "", userRecord{}, err
	}
	if err := s.q.CreateTeam(ctx, dbsqlc.CreateTeamParams{
		ID:        teamID,
		CreatedAt: toPgTimestamptz(now),
	}); err != nil {
		return "", userRecord{}, err
	}
	if err := s.q.AddTeamMember(ctx, dbsqlc.AddTeamMemberParams{
		TeamID:    teamID,
		UserID:    user.ID,
		Role:      string(api.Owner),
		CreatedAt: toPgTimestamptz(now),
	}); err != nil {
		return "", userRecord{}, err
	}
	return user.ID, user, nil
}

func (s *Store) GetMe(ctx context.Context, userID string) (api.MeResponse, error) {
	row, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return api.MeResponse{}, errors.New("user not found")
	}
	mRows, err := s.q.ListMembershipsByUserID(ctx, userID)
	if err != nil {
		return api.MeResponse{}, err
	}
	memberships := make([]api.TeamMembership, 0, len(mRows))
	for _, m := range mRows {
		role := api.Member
		if m.Role == string(api.Owner) {
			role = api.Owner
		}
		memberships = append(memberships, api.TeamMembership{TeamId: m.TeamID, Role: role})
	}
	return api.MeResponse{
		User: api.User{
			Id:          row.ID,
			Email:       row.Email,
			DisplayName: row.DisplayName,
			CreatedAt:   row.CreatedAt.Time.In(s.loc),
		},
		Memberships: memberships,
	}, nil
}

func (s *Store) CreateInvite(ctx context.Context, userID string, req api.CreateInviteRequest) (api.InviteCodeResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.InviteCodeResponse{}, err
	}

	maxUses := 1
	if req.MaxUses != nil {
		maxUses = *req.MaxUses
	}
	expiresInHours := 72
	if req.ExpiresInHours != nil {
		expiresInHours = *req.ExpiresInHours
	}
	maxUses32, err := safeInt32(maxUses, "max uses")
	if err != nil {
		return api.InviteCodeResponse{}, err
	}

	raw, err := randomToken()
	if err != nil {
		return api.InviteCodeResponse{}, err
	}
	code := strings.ToUpper(raw[:10])
	expiresAt := time.Now().In(s.loc).Add(time.Duration(expiresInHours) * time.Hour)
	if err := s.q.CreateInviteCode(ctx, dbsqlc.CreateInviteCodeParams{
		Code:      code,
		TeamID:    teamID,
		ExpiresAt: toPgTimestamptz(expiresAt),
		MaxUses:   maxUses32,
		UsedCount: 0,
	}); err != nil {
		return api.InviteCodeResponse{}, err
	}

	return api.InviteCodeResponse{
		Code:      code,
		TeamId:    teamID,
		ExpiresAt: expiresAt,
		MaxUses:   maxUses,
		UsedCount: 0,
	}, nil
}

func (s *Store) JoinTeam(ctx context.Context, userID, code string) (api.JoinTeamResponse, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	invite, err := s.q.GetInviteCode(ctx, code)
	if err != nil {
		return api.JoinTeamResponse{}, errors.New("invite code not found")
	}
	now := time.Now().In(s.loc)
	if invite.ExpiresAt.Time.In(s.loc).Before(now) {
		return api.JoinTeamResponse{}, errors.New("invite code expired")
	}
	if invite.UsedCount >= invite.MaxUses {
		return api.JoinTeamResponse{}, errors.New("invite code max uses exceeded")
	}

	memberships, err := s.q.ListMembershipsByUserID(ctx, userID)
	if err != nil {
		return api.JoinTeamResponse{}, err
	}
	for _, m := range memberships {
		if m.TeamID == invite.TeamID {
			return api.JoinTeamResponse{TeamId: invite.TeamID}, nil
		}
	}
	if len(memberships) > 0 {
		return api.JoinTeamResponse{}, errors.New("user already belongs to a team")
	}

	if err := s.q.AddTeamMember(ctx, dbsqlc.AddTeamMemberParams{
		TeamID:    invite.TeamID,
		UserID:    userID,
		Role:      string(api.Member),
		CreatedAt: toPgTimestamptz(now),
	}); err != nil {
		return api.JoinTeamResponse{}, err
	}
	rows, err := s.q.IncrementInviteCodeUsedCount(ctx, code)
	if err != nil {
		return api.JoinTeamResponse{}, err
	}
	if rows == 0 {
		return api.JoinTeamResponse{}, errors.New("invite code max uses exceeded")
	}
	return api.JoinTeamResponse{TeamId: invite.TeamID}, nil
}

func (s *Store) primaryTeamLocked(ctx context.Context, userID string) (string, error) {
	list, err := s.q.ListMembershipsByUserID(ctx, userID)
	if err != nil {
		return "", err
	}
	if len(list) == 0 {
		return "", errors.New("user has no team membership")
	}
	return list[0].TeamID, nil
}
