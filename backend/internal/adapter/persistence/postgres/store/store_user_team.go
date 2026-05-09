package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	domainteam "github.com/megu/kaji-challenge/backend/internal/domain/team"
)

func (s *Store) getOrCreateUserLocked(ctx context.Context, issuer, subject, email, displayName string) (string, userRecord, error) {
	now := time.Now().In(s.loc)
	issuer = strings.TrimSpace(issuer)
	subject = strings.TrimSpace(subject)
	if issuer == "" || subject == "" {
		return "", userRecord{}, errors.New("forbidden: missing oidc identity")
	}

	row, err := s.q.GetUserByOIDC(ctx, dbsqlc.GetUserByOIDCParams{
		OidcIssuer:  textFromPtr(&issuer),
		OidcSubject: textFromPtr(&subject),
	})
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
		Name:      domainteam.DefaultOwnTeamName(user.Name),
		CreatedAt: toPgTimestamptz(now),
	}); err != nil {
		return "", userRecord{}, err
	}
	if err := s.q.AddTeamMember(ctx, dbsqlc.AddTeamMemberParams{
		TeamID:    teamID,
		UserID:    user.ID,
		Role:      string(model.TeamMembershipRoleOwner),
		CreatedAt: toPgTimestamptz(now),
	}); err != nil {
		return "", userRecord{}, err
	}
	if err := s.syncUserOIDCIdentityLocked(ctx, user.ID, issuer, subject); err != nil {
		return "", userRecord{}, err
	}
	return user.ID, user, nil
}

func (s *Store) syncUserOIDCIdentityLocked(ctx context.Context, userID, issuer, subject string) error {
	issuer = strings.TrimSpace(issuer)
	subject = strings.TrimSpace(subject)
	if issuer == "" || subject == "" {
		return errors.New("forbidden: missing oidc identity")
	}

	rec, err := s.q.GetUserAuthIdentityByID(ctx, userID)
	if err != nil {
		return err
	}
	currentIssuer := strings.TrimSpace(rec.OidcIssuer)
	currentSubject := strings.TrimSpace(rec.OidcSubject)
	if currentIssuer == "" && currentSubject == "" {
		return s.q.UpdateUserOIDCByID(ctx, dbsqlc.UpdateUserOIDCByIDParams{
			ID:           userID,
			Column2:      issuer,
			Column3:      subject,
			OidcLinkedAt: toPgTimestamptz(time.Now().In(s.loc)),
		})
	}
	if currentIssuer == issuer && currentSubject == subject {
		return nil
	}
	return errors.New("forbidden: oidc identity mismatch")
}

func (s *Store) GetMe(ctx context.Context, userID string) (model.MeResponse, error) {
	row, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return model.MeResponse{}, errors.New("user not found")
	}
	mRows, err := s.q.ListMembershipsByUserID(ctx, userID)
	if err != nil {
		return model.MeResponse{}, err
	}
	memberships := make([]model.TeamMembership, 0, len(mRows))
	for _, m := range mRows {
		role := model.TeamMembershipRoleMember
		if m.Role == string(model.TeamMembershipRoleOwner) {
			role = model.TeamMembershipRoleOwner
		}
		memberships = append(memberships, model.TeamMembership{TeamId: m.TeamID, Role: role, TeamName: m.TeamName})
	}
	return model.MeResponse{
		User: model.User{
			Id:          row.ID,
			Email:       row.Email,
			DisplayName: row.DisplayName,
			ColorHex:    ptrFromText(row.ColorHex),
			CreatedAt:   row.CreatedAt.Time.In(s.loc),
		},
		Memberships: memberships,
	}, nil
}

func (s *Store) PatchMeNickname(ctx context.Context, userID string, req model.UpdateNicknameRequest) (model.UpdateNicknameResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return model.UpdateNicknameResponse{}, err
	}
	nickname, err := domainteam.NormalizeNickname(req.Nickname)
	if err != nil {
		return model.UpdateNicknameResponse{}, err
	}
	var res model.UpdateNicknameResponse
	if _, err := s.runWithTeamRevisionCAS(
		ctx,
		teamID,
		"team_member",
		map[string]string{"userId": userID, "action": "nickname_update"},
		func(_ context.Context, qtx *dbsqlc.Queries) error {
			if err := qtx.UpdateUserNickname(ctx, dbsqlc.UpdateUserNicknameParams{ID: userID, Column2: nickname}); err != nil {
				return err
			}
			row, err := qtx.GetUserByID(ctx, userID)
			if err != nil {
				return err
			}
			res = model.UpdateNicknameResponse{
				Nickname:      nickname,
				EffectiveName: domainteam.EffectiveName(row.DisplayName, row.Nickname),
			}
			return nil
		},
	); err != nil {
		return model.UpdateNicknameResponse{}, err
	}
	return res, nil
}

func (s *Store) PatchMeColor(ctx context.Context, userID string, req model.UpdateColorRequest) (model.UpdateColorResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return model.UpdateColorResponse{}, err
	}
	colorHex, err := domainteam.NormalizeColorHex(req.ColorHex)
	if err != nil {
		return model.UpdateColorResponse{}, err
	}
	var res model.UpdateColorResponse
	if _, err := s.runWithTeamRevisionCAS(
		ctx,
		teamID,
		"team_member",
		map[string]string{"userId": userID, "action": "color_update"},
		func(_ context.Context, qtx *dbsqlc.Queries) error {
			if err := qtx.UpdateUserColorHex(ctx, dbsqlc.UpdateUserColorHexParams{
				ID:      userID,
				Column2: colorHex,
			}); err != nil {
				return err
			}
			row, err := qtx.GetUserByID(ctx, userID)
			if err != nil {
				return err
			}
			res = model.UpdateColorResponse{
				ColorHex: ptrFromText(row.ColorHex),
			}
			return nil
		},
	); err != nil {
		return model.UpdateColorResponse{}, err
	}
	return res, nil
}

func (s *Store) CreateInvite(ctx context.Context, userID string, req model.CreateInviteRequest) (model.InviteCodeResponse, error) {
	expiresInHours := 72
	if req.ExpiresInHours != nil {
		expiresInHours = *req.ExpiresInHours
	}

	raw, err := randomToken()
	if err != nil {
		return model.InviteCodeResponse{}, err
	}
	code := strings.ToUpper(raw[:10])
	expiresAt := time.Now().In(s.loc).Add(time.Duration(expiresInHours) * time.Hour)
	membership, err := s.primaryMembershipLocked(ctx, userID)
	if err != nil {
		return model.InviteCodeResponse{}, err
	}
	if _, err := s.runWithTeamRevisionCAS(
		ctx,
		membership.TeamID,
		"invite",
		map[string]string{"action": "create"},
		func(txCtx context.Context, qtx *dbsqlc.Queries) error {
			m, err := s.primaryMembershipLocked(txCtx, userID)
			if err != nil {
				return err
			}
			if m.Role != string(model.TeamMembershipRoleOwner) {
				return errors.New("forbidden: owner role required")
			}
			if err := qtx.DeleteInviteCodesByTeamID(txCtx, m.TeamID); err != nil {
				return err
			}
			return qtx.CreateInviteCode(txCtx, dbsqlc.CreateInviteCodeParams{
				Code:      code,
				TeamID:    m.TeamID,
				ExpiresAt: toPgTimestamptz(expiresAt),
			})
		},
	); err != nil {
		return model.InviteCodeResponse{}, err
	}
	return model.InviteCodeResponse{
		Code:      code,
		TeamId:    membership.TeamID,
		ExpiresAt: expiresAt,
	}, nil
}

func (s *Store) GetTeamCurrentInvite(ctx context.Context, userID string) (model.InviteCodeResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return model.InviteCodeResponse{}, err
	}
	invite, err := s.q.GetLatestInviteCodeByTeamID(ctx, teamID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return model.InviteCodeResponse{}, errors.New("invite code not found")
		}
		return model.InviteCodeResponse{}, err
	}
	return model.InviteCodeResponse{
		Code:      invite.Code,
		TeamId:    invite.TeamID,
		ExpiresAt: invite.ExpiresAt.Time.In(s.loc),
	}, nil
}

func (s *Store) PatchTeamCurrent(ctx context.Context, userID string, req model.UpdateCurrentTeamRequest) (model.TeamInfoResponse, error) {
	membership, err := s.primaryMembershipLocked(ctx, userID)
	if err != nil {
		return model.TeamInfoResponse{}, err
	}
	teamName, err := domainteam.NormalizeName(req.Name)
	if err != nil {
		return model.TeamInfoResponse{}, err
	}
	if _, err := s.runWithTeamRevisionCAS(
		ctx,
		membership.TeamID,
		"team_state",
		map[string]string{"action": "rename"},
		func(_ context.Context, qtx *dbsqlc.Queries) error {
			return qtx.UpdateTeamName(ctx, dbsqlc.UpdateTeamNameParams{ID: membership.TeamID, Name: teamName})
		},
	); err != nil {
		return model.TeamInfoResponse{}, err
	}
	return model.TeamInfoResponse{TeamId: membership.TeamID, Name: teamName}, nil
}

func (s *Store) GetTeamCurrentMembers(ctx context.Context, userID string) (model.TeamMembersResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return model.TeamMembersResponse{}, err
	}
	rows, err := s.q.ListTeamMembersByTeamID(ctx, teamID)
	if err != nil {
		return model.TeamMembersResponse{}, err
	}
	items := make([]model.TeamMember, 0, len(rows))
	for _, row := range rows {
		role := model.TeamMemberRoleMember
		if row.Role == string(model.TeamMembershipRoleOwner) {
			role = model.TeamMemberRoleOwner
		}
		effective := domainteam.EffectiveName(row.DisplayName, row.Nickname)
		var nickname *string
		if strings.TrimSpace(row.Nickname) != "" {
			n := row.Nickname
			nickname = &n
		}
		items = append(items, model.TeamMember{
			UserId:        row.UserID,
			DisplayName:   row.DisplayName,
			Nickname:      nickname,
			EffectiveName: effective,
			ColorHex:      ptrFromText(row.ColorHex),
			JoinedAt:      row.CreatedAt.Time.In(s.loc),
			Role:          role,
		})
	}
	return model.TeamMembersResponse{Items: items}, nil
}

func (s *Store) JoinTeam(ctx context.Context, userID, code string) (model.JoinTeamResponse, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	invite, err := s.q.GetInviteCode(ctx, code)
	if err != nil {
		return model.JoinTeamResponse{}, errors.New("invite code not found")
	}
	now := time.Now().In(s.loc)
	if invite.ExpiresAt.Time.In(s.loc).Before(now) {
		return model.JoinTeamResponse{}, errors.New("invite code expired")
	}

	memberships, err := s.q.ListMembershipsByUserID(ctx, userID)
	if err != nil {
		return model.JoinTeamResponse{}, err
	}
	if len(memberships) > 0 {
		if err := s.verifyIfMatchAgainstTeam(ctx, memberships[0].TeamID, true); err != nil {
			return model.JoinTeamResponse{}, err
		}
	}

	for _, m := range memberships {
		if m.TeamID == invite.TeamID {
			return model.JoinTeamResponse{}, errors.New("already joined team")
		}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return model.JoinTeamResponse{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	qtx := s.q.WithTx(tx)

	if len(memberships) > 0 {
		current := memberships[0]
		deletedOldTeam, err := s.detachFromCurrentTeam(ctx, qtx, userID, current.TeamID, current.Role)
		if err != nil {
			return model.JoinTeamResponse{}, err
		}
		if !deletedOldTeam {
			if err := qtx.DeleteTeamMember(ctx, dbsqlc.DeleteTeamMemberParams{TeamID: current.TeamID, UserID: userID}); err != nil {
				return model.JoinTeamResponse{}, err
			}
		}
	}

	if err := qtx.AddTeamMember(ctx, dbsqlc.AddTeamMemberParams{
		TeamID:    invite.TeamID,
		UserID:    userID,
		Role:      string(model.TeamMembershipRoleMember),
		CreatedAt: toPgTimestamptz(now),
	}); err != nil {
		return model.JoinTeamResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return model.JoinTeamResponse{}, err
	}
	if len(memberships) > 0 && memberships[0].TeamID != invite.TeamID {
		_, _ = s.bumpTeamRevisionBestEffort(ctx, memberships[0].TeamID, "team_member", map[string]string{"action": "leave"})
	}
	_, _ = s.bumpTeamRevisionBestEffort(ctx, invite.TeamID, "team_member", map[string]string{"action": "join"})
	return model.JoinTeamResponse{TeamId: invite.TeamID}, nil
}

func (s *Store) PostTeamLeave(ctx context.Context, userID string) (model.JoinTeamResponse, error) {
	memberships, err := s.q.ListMembershipsByUserID(ctx, userID)
	if err != nil {
		return model.JoinTeamResponse{}, err
	}
	if len(memberships) == 0 {
		return model.JoinTeamResponse{}, errors.New("user has no team membership")
	}
	current := memberships[0]
	if err := s.verifyIfMatchAgainstTeam(ctx, current.TeamID, true); err != nil {
		return model.JoinTeamResponse{}, err
	}
	user, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return model.JoinTeamResponse{}, err
	}

	now := time.Now().In(s.loc)
	newTeamID := s.nextID("team")
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return model.JoinTeamResponse{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	qtx := s.q.WithTx(tx)

	deletedOldTeam, err := s.detachFromCurrentTeam(ctx, qtx, userID, current.TeamID, current.Role)
	if err != nil {
		return model.JoinTeamResponse{}, err
	}
	if !deletedOldTeam {
		if err := qtx.DeleteTeamMember(ctx, dbsqlc.DeleteTeamMemberParams{TeamID: current.TeamID, UserID: userID}); err != nil {
			return model.JoinTeamResponse{}, err
		}
	}

	if err := qtx.CreateTeam(ctx, dbsqlc.CreateTeamParams{
		ID:        newTeamID,
		Name:      domainteam.DefaultOwnTeamName(domainteam.EffectiveName(user.DisplayName, user.Nickname)),
		CreatedAt: toPgTimestamptz(now),
	}); err != nil {
		return model.JoinTeamResponse{}, err
	}
	if err := qtx.AddTeamMember(ctx, dbsqlc.AddTeamMemberParams{
		TeamID:    newTeamID,
		UserID:    userID,
		Role:      string(model.TeamMembershipRoleOwner),
		CreatedAt: toPgTimestamptz(now),
	}); err != nil {
		return model.JoinTeamResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return model.JoinTeamResponse{}, err
	}
	_, _ = s.bumpTeamRevisionBestEffort(ctx, current.TeamID, "team_member", map[string]string{"action": "leave"})
	_, _ = s.bumpTeamRevisionBestEffort(ctx, newTeamID, "team_member", map[string]string{"action": "join"})
	return model.JoinTeamResponse{TeamId: newTeamID}, nil
}

func (s *Store) detachFromCurrentTeam(ctx context.Context, qtx *dbsqlc.Queries, userID, teamID, role string) (bool, error) {
	if err := qtx.ClearTaskAssigneeByTeamAndUser(ctx, dbsqlc.ClearTaskAssigneeByTeamAndUserParams{TeamID: teamID, Column2: userID}); err != nil {
		return false, err
	}

	if role != string(model.TeamMembershipRoleOwner) {
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

	if err := qtx.UpdateTeamMemberRole(ctx, dbsqlc.UpdateTeamMemberRoleParams{TeamID: teamID, UserID: oldestOtherUserID, Role: string(model.TeamMembershipRoleOwner)}); err != nil {
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
	list, err := s.queries(ctx).ListMembershipsByUserID(ctx, userID)
	if err != nil {
		return dbsqlc.ListMembershipsByUserIDRow{}, err
	}
	if len(list) == 0 {
		return dbsqlc.ListMembershipsByUserIDRow{}, errors.New("user has no team membership")
	}
	return list[0], nil
}
