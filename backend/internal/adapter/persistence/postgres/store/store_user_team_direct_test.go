package store

import (
	"context"
	"testing"
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
)

func TestGetOrCreateAuthUserCreatesTeamAndUpdatesDisplayNameByOIDC(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	res, err := s.GetOrCreateAuthUser(ctx, " issuer ", " subject ", "oidc-user@example.com", "Original Name")
	if err != nil {
		t.Fatalf("GetOrCreateAuthUser create failed: %v", err)
	}
	if res.User.Email != "oidc-user@example.com" || res.User.DisplayName != "Original Name" {
		t.Fatalf("unexpected created user: %+v", res)
	}
	me, err := s.GetMe(ctx, res.UserID)
	if err != nil {
		t.Fatalf("GetMe failed: %v", err)
	}
	if len(me.Memberships) != 1 || me.Memberships[0].Role != model.TeamMembershipRoleOwner {
		t.Fatalf("expected owner membership on own team, got %+v", me.Memberships)
	}

	updated, err := s.GetOrCreateAuthUser(ctx, "issuer", "subject", "changed@example.com", "Updated Name")
	if err != nil {
		t.Fatalf("GetOrCreateAuthUser update failed: %v", err)
	}
	if updated.UserID != res.UserID || updated.User.DisplayName != "Updated Name" || updated.User.Email != "oidc-user@example.com" {
		t.Fatalf("expected same OIDC user with updated display name, got %+v", updated)
	}
	if _, err := s.GetOrCreateAuthUser(ctx, "", "subject", "missing@example.com", "Missing"); err == nil {
		t.Fatal("expected missing issuer to fail")
	}
}

func TestTeamProfileAndInviteLifecycle(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	_, ownerID := createTeamWithMember(t, s, "team-owner@example.com", time.Now().In(s.loc))
	_, otherID := createTeamWithMember(t, s, "team-other@example.com", time.Now().In(s.loc))

	nickname, err := s.PatchMeNickname(withLatestIfMatchForUser(t, s, ctx, ownerID), ownerID, model.UpdateNicknameRequest{Nickname: "  Boss  "})
	if err != nil {
		t.Fatalf("PatchMeNickname failed: %v", err)
	}
	if nickname.Nickname != "Boss" || nickname.EffectiveName != "Boss" {
		t.Fatalf("unexpected nickname response: %+v", nickname)
	}

	color := "#AABBCC"
	colorRes, err := s.PatchMeColor(withLatestIfMatchForUser(t, s, ctx, ownerID), ownerID, model.UpdateColorRequest{ColorHex: &color})
	if err != nil {
		t.Fatalf("PatchMeColor failed: %v", err)
	}
	if colorRes.ColorHex == nil || *colorRes.ColorHex != "#AABBCC" {
		t.Fatalf("unexpected color response: %+v", colorRes)
	}

	team, err := s.PatchTeamCurrent(withLatestIfMatchForUser(t, s, ctx, ownerID), ownerID, model.UpdateCurrentTeamRequest{Name: "  Shared Team  "})
	if err != nil {
		t.Fatalf("PatchTeamCurrent failed: %v", err)
	}
	if team.Name != "Shared Team" {
		t.Fatalf("unexpected team response: %+v", team)
	}

	invite, err := s.CreateInvite(withLatestIfMatchForUser(t, s, ctx, ownerID), ownerID, model.CreateInviteRequest{})
	if err != nil {
		t.Fatalf("CreateInvite failed: %v", err)
	}
	currentInvite, err := s.GetTeamCurrentInvite(ctx, ownerID)
	if err != nil {
		t.Fatalf("GetTeamCurrentInvite failed: %v", err)
	}
	if currentInvite.Code != invite.Code || currentInvite.TeamId != invite.TeamId {
		t.Fatalf("unexpected current invite: %+v", currentInvite)
	}

	joined, err := s.JoinTeam(withLatestIfMatchForUser(t, s, ctx, otherID), otherID, invite.Code)
	if err != nil {
		t.Fatalf("JoinTeam failed: %v", err)
	}
	if joined.TeamId != invite.TeamId {
		t.Fatalf("unexpected join response: %+v", joined)
	}

	members, err := s.GetTeamCurrentMembers(ctx, ownerID)
	if err != nil {
		t.Fatalf("GetTeamCurrentMembers failed: %v", err)
	}
	if len(members.Items) != 2 {
		t.Fatalf("expected two team members, got %+v", members.Items)
	}

	left, err := s.PostTeamLeave(withLatestIfMatchForUser(t, s, ctx, otherID), otherID)
	if err != nil {
		t.Fatalf("PostTeamLeave failed: %v", err)
	}
	if left.TeamId == invite.TeamId {
		t.Fatalf("expected leave to create a new own team, got %+v", left)
	}
}

func TestTeamLeaveTransfersOwnerAndClearsAssignee(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Now().In(s.loc)
	teamID, ownerID := createTeamWithMember(t, s, "leaving-owner@example.com", now)
	_, memberID := createTeamWithMember(t, s, "remaining-member@example.com", now)
	if err := s.q.DeleteTeamMember(ctx, dbsqlc.DeleteTeamMemberParams{TeamID: teamIDForUser(t, s, memberID), UserID: memberID}); err != nil {
		t.Fatalf("failed to remove member from own team: %v", err)
	}
	if err := s.q.AddTeamMember(ctx, dbsqlc.AddTeamMemberParams{
		TeamID:    teamID,
		UserID:    memberID,
		Role:      string(model.TeamMembershipRoleMember),
		CreatedAt: toPgTimestamptz(now),
	}); err != nil {
		t.Fatalf("failed to add member to owner team: %v", err)
	}
	taskID := createTaskWithIDAt(t, s, teamID, model.TaskTypeDaily, 1, 1, now)
	if err := s.q.UpdateTask(ctx, dbsqlc.UpdateTaskParams{
		ID:                         taskID,
		Title:                      "assigned",
		Notes:                      textFromPtr(nil),
		PenaltyPoints:              1,
		Column5:                    ownerID,
		RequiredCompletionsPerWeek: 1,
		UpdatedAt:                  toPgTimestamptz(now),
	}); err != nil {
		t.Fatalf("failed to assign task: %v", err)
	}

	if _, err := s.PostTeamLeave(withLatestIfMatchForUser(t, s, ctx, ownerID), ownerID); err != nil {
		t.Fatalf("PostTeamLeave owner failed: %v", err)
	}

	memberships, err := s.q.ListMembershipsByUserID(ctx, memberID)
	if err != nil {
		t.Fatalf("ListMembershipsByUserID failed: %v", err)
	}
	if len(memberships) != 1 || memberships[0].TeamID != teamID || memberships[0].Role != string(model.TeamMembershipRoleOwner) {
		t.Fatalf("expected remaining member to become owner, got %+v", memberships)
	}
	task, err := s.q.GetTaskByID(ctx, taskID)
	if err != nil {
		t.Fatalf("GetTaskByID failed: %v", err)
	}
	if task.AssigneeUserID != "" {
		t.Fatalf("expected leaving owner's task assignment to be cleared, got %+v", task.AssigneeUserID)
	}
}
