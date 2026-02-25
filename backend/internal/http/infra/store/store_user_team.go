package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

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
	if !isSignupAllowedEmail(email) {
		return "", userRecord{}, errors.New("forbidden: signup is disabled for this email")
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
		Name:      defaultOwnTeamName(user.Name),
		CreatedAt: toPgTimestamptz(now),
	}); err != nil {
		return "", userRecord{}, err
	}
	if err := s.q.AddTeamMember(ctx, dbsqlc.AddTeamMemberParams{
		TeamID:    teamID,
		UserID:    user.ID,
		Role:      string(api.TeamMembershipRoleOwner),
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
		role := api.TeamMembershipRoleMember
		if m.Role == string(api.TeamMembershipRoleOwner) {
			role = api.TeamMembershipRoleOwner
		}
		memberships = append(memberships, api.TeamMembership{TeamId: m.TeamID, Role: role, TeamName: m.TeamName})
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

func (s *Store) PatchMeNickname(ctx context.Context, userID string, req api.UpdateNicknameRequest) (api.UpdateNicknameResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.UpdateNicknameResponse{}, err
	}
	if err := s.checkIfMatchPrecondition(ctx, teamID); err != nil {
		return api.UpdateNicknameResponse{}, err
	}
	nickname, err := normalizeNickname(req.Nickname)
	if err != nil {
		return api.UpdateNicknameResponse{}, err
	}
	if err := s.q.UpdateUserNickname(ctx, dbsqlc.UpdateUserNicknameParams{ID: userID, Column2: nickname}); err != nil {
		return api.UpdateNicknameResponse{}, err
	}
	row, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return api.UpdateNicknameResponse{}, err
	}
	return api.UpdateNicknameResponse{
		Nickname:      nickname,
		EffectiveName: effectiveName(row.DisplayName, row.Nickname),
	}, nil
}

func (s *Store) CreateInvite(ctx context.Context, userID string, req api.CreateInviteRequest) (api.InviteCodeResponse, error) {
	membership, err := s.primaryMembershipLocked(ctx, userID)
	if err != nil {
		return api.InviteCodeResponse{}, err
	}
	if err := s.checkIfMatchPrecondition(ctx, membership.TeamID); err != nil {
		return api.InviteCodeResponse{}, err
	}
	if membership.Role != string(api.TeamMembershipRoleOwner) {
		return api.InviteCodeResponse{}, errors.New("forbidden: owner role required")
	}

	expiresInHours := 72
	if req.ExpiresInHours != nil {
		expiresInHours = *req.ExpiresInHours
	}

	raw, err := randomToken()
	if err != nil {
		return api.InviteCodeResponse{}, err
	}
	code := strings.ToUpper(raw[:10])
	expiresAt := time.Now().In(s.loc).Add(time.Duration(expiresInHours) * time.Hour)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return api.InviteCodeResponse{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	qtx := s.q.WithTx(tx)
	if err := qtx.DeleteInviteCodesByTeamID(ctx, membership.TeamID); err != nil {
		return api.InviteCodeResponse{}, err
	}
	if err := qtx.CreateInviteCode(ctx, dbsqlc.CreateInviteCodeParams{
		Code:      code,
		TeamID:    membership.TeamID,
		ExpiresAt: toPgTimestamptz(expiresAt),
	}); err != nil {
		return api.InviteCodeResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return api.InviteCodeResponse{}, err
	}
	if _, err := s.bumpRevisionAndPublish(ctx, membership.TeamID, "invite", map[string]string{"action": "create"}); err != nil {
		return api.InviteCodeResponse{}, err
	}

	return api.InviteCodeResponse{
		Code:      code,
		TeamId:    membership.TeamID,
		ExpiresAt: expiresAt,
	}, nil
}

func (s *Store) GetTeamCurrentInvite(ctx context.Context, userID string) (api.InviteCodeResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.InviteCodeResponse{}, err
	}
	invite, err := s.q.GetLatestInviteCodeByTeamID(ctx, teamID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.InviteCodeResponse{}, errors.New("invite code not found")
		}
		return api.InviteCodeResponse{}, err
	}
	return api.InviteCodeResponse{
		Code:      invite.Code,
		TeamId:    invite.TeamID,
		ExpiresAt: invite.ExpiresAt.Time.In(s.loc),
	}, nil
}

func (s *Store) PatchTeamCurrent(ctx context.Context, userID string, req api.UpdateCurrentTeamRequest) (api.TeamInfoResponse, error) {
	membership, err := s.primaryMembershipLocked(ctx, userID)
	if err != nil {
		return api.TeamInfoResponse{}, err
	}
	if err := s.checkIfMatchPrecondition(ctx, membership.TeamID); err != nil {
		return api.TeamInfoResponse{}, err
	}
	teamName, err := normalizeTeamName(req.Name)
	if err != nil {
		return api.TeamInfoResponse{}, err
	}
	if err := s.q.UpdateTeamName(ctx, dbsqlc.UpdateTeamNameParams{ID: membership.TeamID, Name: teamName}); err != nil {
		return api.TeamInfoResponse{}, err
	}
	if _, err := s.bumpRevisionAndPublish(ctx, membership.TeamID, "team_state", map[string]string{"action": "rename"}); err != nil {
		return api.TeamInfoResponse{}, err
	}
	return api.TeamInfoResponse{TeamId: membership.TeamID, Name: teamName}, nil
}

func (s *Store) GetTeamCurrentMembers(ctx context.Context, userID string) (api.TeamMembersResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.TeamMembersResponse{}, err
	}
	rows, err := s.q.ListTeamMembersByTeamID(ctx, teamID)
	if err != nil {
		return api.TeamMembersResponse{}, err
	}
	items := make([]api.TeamMember, 0, len(rows))
	for _, row := range rows {
		role := api.TeamMemberRoleMember
		if row.Role == string(api.TeamMembershipRoleOwner) {
			role = api.TeamMemberRoleOwner
		}
		effective := effectiveName(row.DisplayName, row.Nickname)
		var nickname *string
		if strings.TrimSpace(row.Nickname) != "" {
			n := row.Nickname
			nickname = &n
		}
		items = append(items, api.TeamMember{
			UserId:        row.UserID,
			DisplayName:   row.DisplayName,
			Nickname:      nickname,
			EffectiveName: effective,
			JoinedAt:      row.CreatedAt.Time.In(s.loc),
			Role:          role,
		})
	}
	return api.TeamMembersResponse{Items: items}, nil
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

	memberships, err := s.q.ListMembershipsByUserID(ctx, userID)
	if err != nil {
		return api.JoinTeamResponse{}, err
	}
	if len(memberships) > 0 {
		if err := s.checkIfMatchPrecondition(ctx, memberships[0].TeamID); err != nil {
			return api.JoinTeamResponse{}, err
		}
	}

	for _, m := range memberships {
		if m.TeamID == invite.TeamID {
			return api.JoinTeamResponse{}, errors.New("already joined team")
		}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return api.JoinTeamResponse{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	qtx := s.q.WithTx(tx)

	if len(memberships) > 0 {
		current := memberships[0]
		deletedOldTeam, err := s.detachFromCurrentTeam(ctx, qtx, userID, current.TeamID, current.Role)
		if err != nil {
			return api.JoinTeamResponse{}, err
		}
		if !deletedOldTeam {
			if err := qtx.DeleteTeamMember(ctx, dbsqlc.DeleteTeamMemberParams{TeamID: current.TeamID, UserID: userID}); err != nil {
				return api.JoinTeamResponse{}, err
			}
		}
	}

	if err := qtx.AddTeamMember(ctx, dbsqlc.AddTeamMemberParams{
		TeamID:    invite.TeamID,
		UserID:    userID,
		Role:      string(api.TeamMembershipRoleMember),
		CreatedAt: toPgTimestamptz(now),
	}); err != nil {
		return api.JoinTeamResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return api.JoinTeamResponse{}, err
	}
	if len(memberships) > 0 && memberships[0].TeamID != invite.TeamID {
		if _, err := s.bumpRevisionAndPublish(ctx, memberships[0].TeamID, "team_member", map[string]string{"action": "leave"}); err != nil {
			return api.JoinTeamResponse{}, err
		}
	}
	if _, err := s.bumpRevisionAndPublish(ctx, invite.TeamID, "team_member", map[string]string{"action": "join"}); err != nil {
		return api.JoinTeamResponse{}, err
	}
	return api.JoinTeamResponse{TeamId: invite.TeamID}, nil
}

func (s *Store) PostTeamLeave(ctx context.Context, userID string) (api.JoinTeamResponse, error) {
	memberships, err := s.q.ListMembershipsByUserID(ctx, userID)
	if err != nil {
		return api.JoinTeamResponse{}, err
	}
	if len(memberships) == 0 {
		return api.JoinTeamResponse{}, errors.New("user has no team membership")
	}
	current := memberships[0]
	if err := s.checkIfMatchPrecondition(ctx, current.TeamID); err != nil {
		return api.JoinTeamResponse{}, err
	}
	user, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return api.JoinTeamResponse{}, err
	}

	now := time.Now().In(s.loc)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return api.JoinTeamResponse{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	qtx := s.q.WithTx(tx)

	deletedOldTeam, err := s.detachFromCurrentTeam(ctx, qtx, userID, current.TeamID, current.Role)
	if err != nil {
		return api.JoinTeamResponse{}, err
	}
	if !deletedOldTeam {
		if err := qtx.DeleteTeamMember(ctx, dbsqlc.DeleteTeamMemberParams{TeamID: current.TeamID, UserID: userID}); err != nil {
			return api.JoinTeamResponse{}, err
		}
	}

	newTeamID := s.nextID("team")
	if err := qtx.CreateTeam(ctx, dbsqlc.CreateTeamParams{
		ID:        newTeamID,
		Name:      defaultOwnTeamName(effectiveName(user.DisplayName, user.Nickname)),
		CreatedAt: toPgTimestamptz(now),
	}); err != nil {
		return api.JoinTeamResponse{}, err
	}
	if err := qtx.AddTeamMember(ctx, dbsqlc.AddTeamMemberParams{
		TeamID:    newTeamID,
		UserID:    userID,
		Role:      string(api.TeamMembershipRoleOwner),
		CreatedAt: toPgTimestamptz(now),
	}); err != nil {
		return api.JoinTeamResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return api.JoinTeamResponse{}, err
	}
	if _, err := s.bumpRevisionAndPublish(ctx, current.TeamID, "team_member", map[string]string{"action": "leave"}); err != nil {
		return api.JoinTeamResponse{}, err
	}
	if _, err := s.bumpRevisionAndPublish(ctx, newTeamID, "team_member", map[string]string{"action": "join"}); err != nil {
		return api.JoinTeamResponse{}, err
	}
	return api.JoinTeamResponse{TeamId: newTeamID}, nil
}

func (s *Store) detachFromCurrentTeam(ctx context.Context, qtx *dbsqlc.Queries, userID, teamID, role string) (bool, error) {
	if err := qtx.ClearTaskAssigneeByTeamAndUser(ctx, dbsqlc.ClearTaskAssigneeByTeamAndUserParams{TeamID: teamID, Column2: userID}); err != nil {
		return false, err
	}

	if role != string(api.TeamMembershipRoleOwner) {
		return false, nil
	}

	oldestOtherUserID, err := qtx.GetOldestOtherTeamMember(ctx, dbsqlc.GetOldestOtherTeamMemberParams{TeamID: teamID, UserID: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			if err := qtx.DeleteTeam(ctx, teamID); err != nil {
				return false, err
			}
			return true, nil
		}
		return false, err
	}

	if err := qtx.UpdateTeamMemberRole(ctx, dbsqlc.UpdateTeamMemberRoleParams{TeamID: teamID, UserID: oldestOtherUserID, Role: string(api.TeamMembershipRoleOwner)}); err != nil {
		return false, err
	}

	return false, nil
}

func (s *Store) primaryTeamLocked(ctx context.Context, userID string) (string, error) {
	membership, err := s.primaryMembershipLocked(ctx, userID)
	if err != nil {
		return "", err
	}
	return membership.TeamID, nil
}

func (s *Store) primaryMembershipLocked(ctx context.Context, userID string) (dbsqlc.ListMembershipsByUserIDRow, error) {
	list, err := s.q.ListMembershipsByUserID(ctx, userID)
	if err != nil {
		return dbsqlc.ListMembershipsByUserIDRow{}, err
	}
	if len(list) == 0 {
		return dbsqlc.ListMembershipsByUserIDRow{}, errors.New("user has no team membership")
	}
	return list[0], nil
}

func normalizeNickname(raw string) (string, error) {
	nickname := strings.TrimSpace(raw)
	if nickname == "" {
		return "", nil
	}
	if count := utf8.RuneCountInString(nickname); count > 30 {
		return "", fmt.Errorf("nickname must be %d characters or fewer", 30)
	}
	return nickname, nil
}

func normalizeTeamName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", errors.New("team name is required")
	}
	if count := utf8.RuneCountInString(name); count < 1 || count > 50 {
		return "", fmt.Errorf("team name must be between %d and %d characters", 1, 50)
	}
	return name, nil
}

func effectiveName(displayName, nickname string) string {
	trimmedNickname := strings.TrimSpace(nickname)
	if trimmedNickname != "" {
		return trimmedNickname
	}
	trimmedDisplayName := strings.TrimSpace(displayName)
	if trimmedDisplayName != "" {
		return trimmedDisplayName
	}
	return "User"
}

func defaultOwnTeamName(base string) string {
	name := strings.TrimSpace(base)
	if name == "" {
		name = "My Team"
	}
	name = name + " Team"
	if utf8.RuneCountInString(name) > 50 {
		runes := []rune(name)
		name = string(runes[:50])
	}
	return name
}
