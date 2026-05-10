package transport

import (
	"encoding/json"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
	"net/http"
	"testing"
	"time"
)

func TestInviteJoinFlow(t *testing.T) {
	r := newTestRouter(t)
	ownerToken := loginAs(t, r, "invite-flow-owner@example.com")
	inviteRes := doRequest(t, r, http.MethodPost, "/v1/teams/invites", `{"expiresInHours":72}`, ownerToken)
	if inviteRes.Code != http.StatusCreated {
		t.Fatalf("expected 201 invite create, got %d: %s", inviteRes.Code, inviteRes.Body.String())
	}

	var invite api.InviteCodeResponse
	if err := json.Unmarshal(inviteRes.Body.Bytes(), &invite); err != nil {
		t.Fatalf("failed to parse invite response: %v", err)
	}
	if invite.Code == "" {
		t.Fatalf("expected invite code")
	}

	memberToken := loginAs(t, r, "invite-flow-member@example.com")
	joinRes := doRequest(t, r, http.MethodPost, "/v1/teams/join", `{"code":"`+invite.Code+`"}`, memberToken)
	if joinRes.Code != http.StatusOK {
		t.Fatalf("expected 200 join, got %d: %s", joinRes.Code, joinRes.Body.String())
	}
}

func TestJoinOwnTeamInviteReturnsConflict(t *testing.T) {
	r := newTestRouter(t)
	ownerToken := loginAs(t, r, "owner-join-own-team@example.com")
	inviteRes := doRequest(t, r, http.MethodPost, "/v1/teams/invites", `{"expiresInHours":72}`, ownerToken)
	if inviteRes.Code != http.StatusCreated {
		t.Fatalf("expected 201 invite create, got %d: %s", inviteRes.Code, inviteRes.Body.String())
	}

	var invite api.InviteCodeResponse
	if err := json.Unmarshal(inviteRes.Body.Bytes(), &invite); err != nil {
		t.Fatalf("failed to parse invite response: %v", err)
	}

	joinRes := doRequest(t, r, http.MethodPost, "/v1/teams/join", `{"code":"`+invite.Code+`"}`, ownerToken)
	if joinRes.Code != http.StatusConflict {
		t.Fatalf("expected 409 join own team, got %d: %s", joinRes.Code, joinRes.Body.String())
	}
}

func TestInviteCreateRotatesCodeByHardDelete(t *testing.T) {
	r := newTestRouter(t)
	ownerToken := loginAs(t, r, "invite-owner-rotate@example.com")

	firstInviteRes := doRequest(t, r, http.MethodPost, "/v1/teams/invites", `{"expiresInHours":72}`, ownerToken)
	if firstInviteRes.Code != http.StatusCreated {
		t.Fatalf("expected first invite create 201, got %d: %s", firstInviteRes.Code, firstInviteRes.Body.String())
	}
	var firstInvite api.InviteCodeResponse
	if err := json.Unmarshal(firstInviteRes.Body.Bytes(), &firstInvite); err != nil {
		t.Fatalf("failed to parse first invite response: %v", err)
	}

	secondInviteRes := doRequest(t, r, http.MethodPost, "/v1/teams/invites", `{"expiresInHours":72}`, ownerToken)
	if secondInviteRes.Code != http.StatusCreated {
		t.Fatalf("expected second invite create 201, got %d: %s", secondInviteRes.Code, secondInviteRes.Body.String())
	}
	var secondInvite api.InviteCodeResponse
	if err := json.Unmarshal(secondInviteRes.Body.Bytes(), &secondInvite); err != nil {
		t.Fatalf("failed to parse second invite response: %v", err)
	}
	if secondInvite.Code == firstInvite.Code {
		t.Fatalf("expected rotated invite code, got identical code")
	}

	memberToken := loginAs(t, r, "invite-rotate-member@example.com")
	memberID := fetchMeUserID(t, r, memberToken)
	clearTeamMembershipsForTest(t, memberID)

	oldJoinRes := doRequest(t, r, http.MethodPost, "/v1/teams/join", `{"code":"`+firstInvite.Code+`"}`, memberToken)
	if oldJoinRes.Code < 400 || oldJoinRes.Code >= 500 {
		t.Fatalf("expected old invite join 4xx, got %d: %s", oldJoinRes.Code, oldJoinRes.Body.String())
	}

	newJoinRes := doRequest(t, r, http.MethodPost, "/v1/teams/join", `{"code":"`+secondInvite.Code+`"}`, memberToken)
	if newJoinRes.Code != http.StatusOK {
		t.Fatalf("expected new invite join 200, got %d: %s", newJoinRes.Code, newJoinRes.Body.String())
	}
}

func TestInviteIsMultiUseUntilExpiration(t *testing.T) {
	r := newTestRouter(t)
	ownerToken := loginAs(t, r, "invite-owner-single-use@example.com")

	inviteRes := doRequest(t, r, http.MethodPost, "/v1/teams/invites", `{"expiresInHours":72}`, ownerToken)
	if inviteRes.Code != http.StatusCreated {
		t.Fatalf("expected invite create 201, got %d: %s", inviteRes.Code, inviteRes.Body.String())
	}
	var invite api.InviteCodeResponse
	if err := json.Unmarshal(inviteRes.Body.Bytes(), &invite); err != nil {
		t.Fatalf("failed to parse invite response: %v", err)
	}

	firstMemberToken := loginAs(t, r, "invite-single-member-1@example.com")
	firstMemberID := fetchMeUserID(t, r, firstMemberToken)
	clearTeamMembershipsForTest(t, firstMemberID)
	firstJoinRes := doRequest(t, r, http.MethodPost, "/v1/teams/join", `{"code":"`+invite.Code+`"}`, firstMemberToken)
	if firstJoinRes.Code != http.StatusOK {
		t.Fatalf("expected first invite join 200, got %d: %s", firstJoinRes.Code, firstJoinRes.Body.String())
	}

	secondMemberToken := loginAs(t, r, "invite-single-member-2@example.com")
	secondMemberID := fetchMeUserID(t, r, secondMemberToken)
	clearTeamMembershipsForTest(t, secondMemberID)
	secondJoinRes := doRequest(t, r, http.MethodPost, "/v1/teams/join", `{"code":"`+invite.Code+`"}`, secondMemberToken)
	if secondJoinRes.Code != http.StatusOK {
		t.Fatalf("expected second invite join 200, got %d: %s", secondJoinRes.Code, secondJoinRes.Body.String())
	}
}

func TestInviteResponseHasExpiresAt(t *testing.T) {
	r := newTestRouter(t)
	ownerToken := loginAs(t, r, "invite-owner-max-uses@example.com")

	inviteRes := doRequest(t, r, http.MethodPost, "/v1/teams/invites", `{"expiresInHours":72}`, ownerToken)
	if inviteRes.Code != http.StatusCreated {
		t.Fatalf("expected invite create 201, got %d: %s", inviteRes.Code, inviteRes.Body.String())
	}
	var invite api.InviteCodeResponse
	if err := json.Unmarshal(inviteRes.Body.Bytes(), &invite); err != nil {
		t.Fatalf("failed to parse invite response: %v", err)
	}
	if invite.ExpiresAt.IsZero() {
		t.Fatalf("expected expiresAt to be set")
	}
}

func TestGetCurrentInviteReturnsLatestForTeam(t *testing.T) {
	r := newTestRouter(t)
	ownerToken := loginAs(t, r, "invite-current-owner@example.com")

	inviteRes := doRequest(t, r, http.MethodPost, "/v1/teams/invites", `{"expiresInHours":72}`, ownerToken)
	if inviteRes.Code != http.StatusCreated {
		t.Fatalf("expected invite create 201, got %d: %s", inviteRes.Code, inviteRes.Body.String())
	}
	var invite api.InviteCodeResponse
	if err := json.Unmarshal(inviteRes.Body.Bytes(), &invite); err != nil {
		t.Fatalf("failed to parse invite response: %v", err)
	}

	currentRes := doRequest(t, r, http.MethodGet, "/v1/teams/invites/current", "", ownerToken)
	if currentRes.Code != http.StatusOK {
		t.Fatalf("expected current invite 200, got %d: %s", currentRes.Code, currentRes.Body.String())
	}
	var current api.InviteCodeResponse
	if err := json.Unmarshal(currentRes.Body.Bytes(), &current); err != nil {
		t.Fatalf("failed to parse current invite response: %v", err)
	}
	if current.Code != invite.Code {
		t.Fatalf("expected current code %s, got %s", invite.Code, current.Code)
	}
}

func TestGetCurrentInviteReturnsExpiredInvite(t *testing.T) {
	r := newTestRouter(t)
	ownerToken := loginAs(t, r, "invite-current-expired-owner@example.com")

	inviteRes := doRequest(t, r, http.MethodPost, "/v1/teams/invites", `{"expiresInHours":-1}`, ownerToken)
	if inviteRes.Code != http.StatusCreated {
		t.Fatalf("expected invite create 201, got %d: %s", inviteRes.Code, inviteRes.Body.String())
	}

	currentRes := doRequest(t, r, http.MethodGet, "/v1/teams/invites/current", "", ownerToken)
	if currentRes.Code != http.StatusOK {
		t.Fatalf("expected current invite 200, got %d: %s", currentRes.Code, currentRes.Body.String())
	}
	var current api.InviteCodeResponse
	if err := json.Unmarshal(currentRes.Body.Bytes(), &current); err != nil {
		t.Fatalf("failed to parse current invite response: %v", err)
	}
	if !current.ExpiresAt.Before(time.Now()) {
		t.Fatalf("expected expired invite, got expiresAt=%s", current.ExpiresAt)
	}
}

func TestPatchMeNicknameAndListMembers(t *testing.T) {
	r := newTestRouter(t)
	token := loginAs(t, r, "nickname-owner@example.com")

	patchRes := doRequest(t, r, http.MethodPatch, "/v1/me/nickname", `{"nickname":"にっく"}`, token)
	if patchRes.Code != http.StatusOK {
		t.Fatalf("expected nickname patch 200, got %d: %s", patchRes.Code, patchRes.Body.String())
	}
	var patched api.UpdateNicknameResponse
	if err := json.Unmarshal(patchRes.Body.Bytes(), &patched); err != nil {
		t.Fatalf("failed to parse nickname patch response: %v", err)
	}
	if patched.Nickname != "にっく" || patched.EffectiveName != "にっく" {
		t.Fatalf("unexpected patch response: %+v", patched)
	}

	membersRes := doRequest(t, r, http.MethodGet, "/v1/teams/current/members", "", token)
	if membersRes.Code != http.StatusOK {
		t.Fatalf("expected members 200, got %d: %s", membersRes.Code, membersRes.Body.String())
	}
	var members api.TeamMembersResponse
	if err := json.Unmarshal(membersRes.Body.Bytes(), &members); err != nil {
		t.Fatalf("failed to parse members response: %v", err)
	}
	if len(members.Items) == 0 {
		t.Fatalf("expected at least one member")
	}
	if members.Items[0].EffectiveName != "にっく" {
		t.Fatalf("expected nickname to be preferred, got %q", members.Items[0].EffectiveName)
	}
	if members.Items[0].JoinedAt.IsZero() {
		t.Fatalf("expected joinedAt")
	}

	clearRes := doRequest(t, r, http.MethodPatch, "/v1/me/nickname", `{"nickname":""}`, token)
	if clearRes.Code != http.StatusOK {
		t.Fatalf("expected nickname clear 200, got %d: %s", clearRes.Code, clearRes.Body.String())
	}
	var cleared api.UpdateNicknameResponse
	if err := json.Unmarshal(clearRes.Body.Bytes(), &cleared); err != nil {
		t.Fatalf("failed to parse nickname clear response: %v", err)
	}
	if cleared.Nickname != "" {
		t.Fatalf("expected cleared nickname to be empty, got %q", cleared.Nickname)
	}
	if cleared.EffectiveName != "Test User" {
		t.Fatalf("expected effectiveName fallback to displayName, got %q", cleared.EffectiveName)
	}

	membersRes = doRequest(t, r, http.MethodGet, "/v1/teams/current/members", "", token)
	if membersRes.Code != http.StatusOK {
		t.Fatalf("expected members 200 after clear, got %d: %s", membersRes.Code, membersRes.Body.String())
	}
	if err := json.Unmarshal(membersRes.Body.Bytes(), &members); err != nil {
		t.Fatalf("failed to parse members response after clear: %v", err)
	}
	if len(members.Items) == 0 {
		t.Fatalf("expected at least one member after clear")
	}
	if members.Items[0].Nickname != nil {
		t.Fatalf("expected nickname to be null after clear, got %+v", members.Items[0].Nickname)
	}
	if members.Items[0].EffectiveName != "Test User" {
		t.Fatalf("expected displayName fallback after clear, got %q", members.Items[0].EffectiveName)
	}
}

func TestPatchMeColorAndListMembers(t *testing.T) {
	r := newTestRouter(t)
	token := loginAs(t, r, "color-owner@example.com")

	patchRes := doRequest(t, r, http.MethodPatch, "/v1/me/color", `{"colorHex":"#a1b2c3"}`, token)
	if patchRes.Code != http.StatusOK {
		t.Fatalf("expected color patch 200, got %d: %s", patchRes.Code, patchRes.Body.String())
	}
	var patched api.UpdateColorResponse
	if err := json.Unmarshal(patchRes.Body.Bytes(), &patched); err != nil {
		t.Fatalf("failed to parse color patch response: %v", err)
	}
	if patched.ColorHex == nil || *patched.ColorHex != "#A1B2C3" {
		t.Fatalf("expected normalized color #A1B2C3, got %+v", patched.ColorHex)
	}

	membersRes := doRequest(t, r, http.MethodGet, "/v1/teams/current/members", "", token)
	if membersRes.Code != http.StatusOK {
		t.Fatalf("expected members 200, got %d: %s", membersRes.Code, membersRes.Body.String())
	}
	var members api.TeamMembersResponse
	if err := json.Unmarshal(membersRes.Body.Bytes(), &members); err != nil {
		t.Fatalf("failed to parse members response: %v", err)
	}
	if len(members.Items) == 0 {
		t.Fatalf("expected at least one member")
	}
	if members.Items[0].ColorHex == nil || *members.Items[0].ColorHex != "#A1B2C3" {
		t.Fatalf("expected member color #A1B2C3, got %+v", members.Items[0].ColorHex)
	}

	resetRes := doRequest(t, r, http.MethodPatch, "/v1/me/color", `{"colorHex":null}`, token)
	if resetRes.Code != http.StatusOK {
		t.Fatalf("expected color reset 200, got %d: %s", resetRes.Code, resetRes.Body.String())
	}
	var reset api.UpdateColorResponse
	if err := json.Unmarshal(resetRes.Body.Bytes(), &reset); err != nil {
		t.Fatalf("failed to parse color reset response: %v", err)
	}
	if reset.ColorHex != nil {
		t.Fatalf("expected nil color after reset, got %+v", reset.ColorHex)
	}
}

func TestPatchTeamCurrentName(t *testing.T) {
	r := newTestRouter(t)
	token := loginAs(t, r, "team-name-owner@example.com")

	patchRes := doRequest(t, r, http.MethodPatch, "/v1/teams/current", `{"name":"チーム名テスト"}`, token)
	if patchRes.Code != http.StatusOK {
		t.Fatalf("expected team patch 200, got %d: %s", patchRes.Code, patchRes.Body.String())
	}

	meRes := doRequest(t, r, http.MethodGet, "/v1/me", "", token)
	if meRes.Code != http.StatusOK {
		t.Fatalf("expected me 200, got %d: %s", meRes.Code, meRes.Body.String())
	}
	var me api.MeResponse
	if err := json.Unmarshal(meRes.Body.Bytes(), &me); err != nil {
		t.Fatalf("failed to parse me response: %v", err)
	}
	if len(me.Memberships) == 0 || me.Memberships[0].TeamName != "チーム名テスト" {
		t.Fatalf("expected team name to be updated")
	}
}

func TestJoinMovesMembershipAndLeaveRecreatesOwnerTeam(t *testing.T) {
	r := newTestRouter(t)
	ownerToken := loginAs(t, r, "move-owner@example.com")
	joinerToken := loginAs(t, r, "move-joiner@example.com")

	inviteRes := doRequest(t, r, http.MethodPost, "/v1/teams/invites", `{"expiresInHours":72}`, ownerToken)
	if inviteRes.Code != http.StatusCreated {
		t.Fatalf("expected invite create 201, got %d: %s", inviteRes.Code, inviteRes.Body.String())
	}
	var invite api.InviteCodeResponse
	if err := json.Unmarshal(inviteRes.Body.Bytes(), &invite); err != nil {
		t.Fatalf("failed to parse invite response: %v", err)
	}

	joinRes := doRequest(t, r, http.MethodPost, "/v1/teams/join", `{"code":"`+invite.Code+`"}`, joinerToken)
	if joinRes.Code != http.StatusOK {
		t.Fatalf("expected join 200, got %d: %s", joinRes.Code, joinRes.Body.String())
	}
	var joined api.JoinTeamResponse
	if err := json.Unmarshal(joinRes.Body.Bytes(), &joined); err != nil {
		t.Fatalf("failed to parse join response: %v", err)
	}
	if joined.TeamId != invite.TeamId {
		t.Fatalf("expected join target team %s, got %s", invite.TeamId, joined.TeamId)
	}

	leaveRes := doRequest(t, r, http.MethodPost, "/v1/teams/leave", "", joinerToken)
	if leaveRes.Code != http.StatusOK {
		t.Fatalf("expected leave 200, got %d: %s", leaveRes.Code, leaveRes.Body.String())
	}
	var leave api.JoinTeamResponse
	if err := json.Unmarshal(leaveRes.Body.Bytes(), &leave); err != nil {
		t.Fatalf("failed to parse leave response: %v", err)
	}
	if leave.TeamId == invite.TeamId {
		t.Fatalf("expected recreated own team id to differ from joined team")
	}
}
