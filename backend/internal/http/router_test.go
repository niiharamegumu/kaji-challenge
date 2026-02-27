package http

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/megu/kaji-challenge/backend/internal/http/infra"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
	"github.com/megu/kaji-challenge/backend/internal/testutil/dbtest"
)

func TestHealth(t *testing.T) {
	r := newTestRouter(t)
	res := doRequest(t, r, http.MethodGet, "/health", "", "")
	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.Code)
	}
}

func TestAuthFlowRoutesExist(t *testing.T) {
	r := newTestRouter(t)
	res := doRequest(t, r, http.MethodGet, "/v1/auth/google/start", "", "")
	if res.Code != http.StatusOK {
		t.Fatalf("expected 200 on auth start, got %d: %s", res.Code, res.Body.String())
	}

	var start api.AuthStartResponse
	if err := json.Unmarshal(res.Body.Bytes(), &start); err != nil {
		t.Fatalf("failed to parse auth start response: %v", err)
	}
	if start.AuthorizationUrl == "" {
		t.Fatalf("expected authorization url")
	}
}

func TestNewRouterPanicsWhenStrictModeMissingOIDCEnv(t *testing.T) {
	t.Setenv("OIDC_STRICT_MODE", "true")
	t.Setenv("OIDC_ISSUER_URL", "")
	t.Setenv("OIDC_CLIENT_ID", "")
	t.Setenv("OIDC_CLIENT_SECRET", "")
	t.Setenv("OIDC_REDIRECT_URL", "")

	defer func() {
		if recover() == nil {
			t.Fatalf("expected panic when strict mode env is incomplete")
		}
	}()
	_ = NewRouter()
}

func TestNewRouterPanicsWhenSignupGuardEnabledWithoutAllowlist(t *testing.T) {
	t.Setenv("SIGNUP_GUARD_ENABLED", "true")
	t.Setenv("SIGNUP_ALLOWED_EMAILS", "")

	defer func() {
		if recover() == nil {
			t.Fatalf("expected panic when signup guard is enabled without allowlist")
		}
	}()
	_ = NewRouter()
}

func TestCompleteGoogleAuthRejectsMockParamsInStrictMode(t *testing.T) {
	t.Setenv("OIDC_STRICT_MODE", "true")
	loc, _ := time.LoadLocation("Asia/Tokyo")
	if loc == nil {
		loc = time.FixedZone("JST", 9*60*60)
	}

	err := infra.RejectMockParamsInStrictModeForTest(context.Background(), loc)
	if err == nil || !strings.Contains(err.Error(), "disabled") {
		t.Fatalf("expected strict mode mock rejection, got: %v", err)
	}
}

func TestSignupGuardAllowsListedEmailAndRejectsOthers(t *testing.T) {
	r := newTestRouter(t)
	t.Setenv("SIGNUP_GUARD_ENABLED", "true")
	t.Setenv("SIGNUP_ALLOWED_EMAILS", "allowed@example.com")

	_ = loginAs(t, r, "allowed@example.com")

	callbackRes := startGoogleAuthCallbackWithMockEmail(t, r, "blocked@example.com")
	if callbackRes.Code != http.StatusForbidden {
		t.Fatalf("expected callback 403 for blocked signup, got %d: %s", callbackRes.Code, callbackRes.Body.String())
	}
}

func TestSignupGuardAllowsExistingUserEvenAfterAllowlistChange(t *testing.T) {
	r := newTestRouter(t)
	t.Setenv("SIGNUP_GUARD_ENABLED", "true")
	t.Setenv("SIGNUP_ALLOWED_EMAILS", "existing@example.com")

	_ = loginAs(t, r, "existing@example.com")

	t.Setenv("SIGNUP_ALLOWED_EMAILS", "other@example.com")
	_ = loginAs(t, r, "existing@example.com")
}

func TestAuthCallbackFailureRedirectsToFrontendWithErrorCode(t *testing.T) {
	r := newTestRouter(t)
	t.Setenv("SIGNUP_GUARD_ENABLED", "true")
	t.Setenv("SIGNUP_ALLOWED_EMAILS", "allowed@example.com")
	t.Setenv("FRONTEND_CALLBACK_URL", "http://localhost:5173/auth/callback")

	callbackRes := startGoogleAuthCallbackWithMockEmail(t, r, "blocked@example.com")
	if callbackRes.Code != http.StatusFound {
		t.Fatalf("expected callback 302 for blocked signup, got %d: %s", callbackRes.Code, callbackRes.Body.String())
	}

	loc := callbackRes.Header().Get("Location")
	redirectURL, err := url.Parse(loc)
	if err != nil {
		t.Fatalf("failed to parse redirect location: %v", err)
	}
	if redirectURL.Query().Get("errorCode") != "signup_forbidden" {
		t.Fatalf("expected errorCode=signup_forbidden, got %q", redirectURL.Query().Get("errorCode"))
	}
}

func TestProtectedRouteRequiresAuth(t *testing.T) {
	r := newTestRouter(t)
	res := doRequest(t, r, http.MethodGet, "/v1/me", "", "")
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", res.Code)
	}
}

func TestProtectedRouteRejectsExpiredSession(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	expireSessionForTest(t, token)

	res := doRequest(t, r, http.MethodGet, "/v1/me", "", token)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", res.Code, res.Body.String())
	}
}

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

func TestTaskLifecycleAndTaskOverview(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	taskRes := doRequest(t, r, http.MethodPost, "/v1/tasks", `{"title":"皿洗い","type":"daily","penaltyPoints":2}`, token)
	if taskRes.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", taskRes.Code, taskRes.Body.String())
	}

	var task api.Task
	if err := json.Unmarshal(taskRes.Body.Bytes(), &task); err != nil {
		t.Fatalf("failed to parse task: %v", err)
	}

	loc, _ := time.LoadLocation("Asia/Tokyo")
	if loc == nil {
		loc = time.FixedZone("JST", 9*60*60)
	}
	toggleReq := `{"targetDate":"` + time.Now().In(loc).Format("2006-01-02") + `"}`
	toggleRes := doRequest(t, r, http.MethodPost, "/v1/tasks/"+task.Id+"/completions/toggle", toggleReq, token)
	if toggleRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", toggleRes.Code, toggleRes.Body.String())
	}

	taskOverviewRes := doRequest(t, r, http.MethodGet, "/v1/tasks/overview", "", token)
	if taskOverviewRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", taskOverviewRes.Code, taskOverviewRes.Body.String())
	}

	var taskOverview api.TaskOverviewResponse
	if err := json.Unmarshal(taskOverviewRes.Body.Bytes(), &taskOverview); err != nil {
		t.Fatalf("failed to parse task overview: %v", err)
	}
	if len(taskOverview.DailyTasks) == 0 {
		t.Fatalf("expected at least one daily task in task overview response")
	}
}

func TestDeleteTaskSoftDeleteExcludesFromList(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	taskRes := doRequest(t, r, http.MethodPost, "/v1/tasks", `{"title":"ソフト削除確認","type":"daily","penaltyPoints":2}`, token)
	if taskRes.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", taskRes.Code, taskRes.Body.String())
	}

	var task api.Task
	if err := json.Unmarshal(taskRes.Body.Bytes(), &task); err != nil {
		t.Fatalf("failed to parse task: %v", err)
	}

	deleteRes := doRequest(t, r, http.MethodDelete, "/v1/tasks/"+task.Id, "", token)
	if deleteRes.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", deleteRes.Code, deleteRes.Body.String())
	}

	listRes := doRequest(t, r, http.MethodGet, "/v1/tasks", "", token)
	if listRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", listRes.Code, listRes.Body.String())
	}

	var listed struct {
		Items []api.Task `json:"items"`
	}
	if err := json.Unmarshal(listRes.Body.Bytes(), &listed); err != nil {
		t.Fatalf("failed to parse task list response: %v", err)
	}
	for _, item := range listed.Items {
		if item.Id == task.Id {
			t.Fatalf("deleted task should not appear in list")
		}
	}
}

func TestMonthlySummaryOmitsTaskAfterSameDayDelete(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	taskRes := doRequest(t, r, http.MethodPost, "/v1/tasks", `{"title":"月次履歴タスク","type":"daily","penaltyPoints":2}`, token)
	if taskRes.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", taskRes.Code, taskRes.Body.String())
	}

	var task api.Task
	if err := json.Unmarshal(taskRes.Body.Bytes(), &task); err != nil {
		t.Fatalf("failed to parse task: %v", err)
	}

	loc, _ := time.LoadLocation("Asia/Tokyo")
	if loc == nil {
		loc = time.FixedZone("JST", 9*60*60)
	}
	today := time.Now().In(loc).Format("2006-01-02")
	targetMonth := time.Now().In(loc).Format("2006-01")

	toggleReq := `{"targetDate":"` + today + `"}`
	toggleRes := doRequest(t, r, http.MethodPost, "/v1/tasks/"+task.Id+"/completions/toggle", toggleReq, token)
	if toggleRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", toggleRes.Code, toggleRes.Body.String())
	}

	beforeRes := doRequest(t, r, http.MethodGet, "/v1/penalty-summaries/monthly?month="+targetMonth, "", token)
	if beforeRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", beforeRes.Code, beforeRes.Body.String())
	}
	var before api.MonthlyPenaltySummary
	if err := json.Unmarshal(beforeRes.Body.Bytes(), &before); err != nil {
		t.Fatalf("failed to parse monthly summary(before): %v", err)
	}

	deleteRes := doRequest(t, r, http.MethodDelete, "/v1/tasks/"+task.Id, "", token)
	if deleteRes.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", deleteRes.Code, deleteRes.Body.String())
	}

	afterRes := doRequest(t, r, http.MethodGet, "/v1/penalty-summaries/monthly?month="+targetMonth, "", token)
	if afterRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", afterRes.Code, afterRes.Body.String())
	}
	var after api.MonthlyPenaltySummary
	if err := json.Unmarshal(afterRes.Body.Bytes(), &after); err != nil {
		t.Fatalf("failed to parse monthly summary(after): %v", err)
	}

	if before.DailyPenaltyTotal != after.DailyPenaltyTotal || before.WeeklyPenaltyTotal != after.WeeklyPenaltyTotal || before.TotalPenalty != after.TotalPenalty {
		t.Fatalf("monthly penalty totals should remain unchanged after task soft delete")
	}

	for _, group := range after.TaskStatusByDate {
		if group.Date.Time.Format("2006-01-02") != today {
			continue
		}
		for _, item := range group.Items {
			if item.TaskId == task.Id {
				t.Fatalf("task should not appear in summary on/after delete date")
			}
		}
	}
}

func TestPenaltyRuleIgnoresLegacyIsActiveField(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	createRes := doRequest(t, r, http.MethodPost, "/v1/penalty-rules", `{"name":"遅刻","threshold":3,"isActive":false}`, token)
	if createRes.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", createRes.Code, createRes.Body.String())
	}

	var created map[string]any
	if err := json.Unmarshal(createRes.Body.Bytes(), &created); err != nil {
		t.Fatalf("failed to parse create penalty response: %v", err)
	}
	if _, exists := created["isActive"]; exists {
		t.Fatalf("penalty rule response must not contain isActive")
	}

	var createdRule api.PenaltyRule
	if err := json.Unmarshal(createRes.Body.Bytes(), &createdRule); err != nil {
		t.Fatalf("failed to parse created penalty rule: %v", err)
	}

	patchRes := doRequest(t, r, http.MethodPatch, "/v1/penalty-rules/"+createdRule.Id, `{"name":"遅刻(更新)","isActive":true}`, token)
	if patchRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", patchRes.Code, patchRes.Body.String())
	}
	var patched map[string]any
	if err := json.Unmarshal(patchRes.Body.Bytes(), &patched); err != nil {
		t.Fatalf("failed to parse patch penalty response: %v", err)
	}
	if _, exists := patched["isActive"]; exists {
		t.Fatalf("patched penalty rule response must not contain isActive")
	}
}

func TestDeletePenaltyRuleSoftDeleteExcludesFromDefaultList(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	createRes := doRequest(t, r, http.MethodPost, "/v1/penalty-rules", `{"name":"深夜帰宅","threshold":5}`, token)
	if createRes.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", createRes.Code, createRes.Body.String())
	}
	var created api.PenaltyRule
	if err := json.Unmarshal(createRes.Body.Bytes(), &created); err != nil {
		t.Fatalf("failed to parse created penalty rule: %v", err)
	}

	deleteRes := doRequest(t, r, http.MethodDelete, "/v1/penalty-rules/"+created.Id, "", token)
	if deleteRes.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", deleteRes.Code, deleteRes.Body.String())
	}

	listRes := doRequest(t, r, http.MethodGet, "/v1/penalty-rules", "", token)
	if listRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", listRes.Code, listRes.Body.String())
	}
	var listed struct {
		Items []api.PenaltyRule `json:"items"`
	}
	if err := json.Unmarshal(listRes.Body.Bytes(), &listed); err != nil {
		t.Fatalf("failed to parse list penalty response: %v", err)
	}
	for _, item := range listed.Items {
		if item.Id == created.Id {
			t.Fatalf("deleted penalty rule should not appear in default list")
		}
	}

	listWithDeletedRes := doRequest(t, r, http.MethodGet, "/v1/penalty-rules?includeDeleted=true", "", token)
	if listWithDeletedRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", listWithDeletedRes.Code, listWithDeletedRes.Body.String())
	}
	if err := json.Unmarshal(listWithDeletedRes.Body.Bytes(), &listed); err != nil {
		t.Fatalf("failed to parse list(includeDeleted) response: %v", err)
	}
	foundDeleted := false
	for _, item := range listed.Items {
		if item.Id != created.Id {
			continue
		}
		foundDeleted = true
		if item.DeletedAt == nil {
			t.Fatalf("includeDeleted list must expose deletedAt for soft-deleted rule")
		}
	}
	if !foundDeleted {
		t.Fatalf("expected soft-deleted rule in includeDeleted list")
	}
}

func TestWeeklyTaskIncrementDecrement(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	taskRes := doRequest(t, r, http.MethodPost, "/v1/tasks", `{"title":"シンク洗い","type":"weekly","penaltyPoints":2,"requiredCompletionsPerWeek":3}`, token)
	if taskRes.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", taskRes.Code, taskRes.Body.String())
	}

	var task api.Task
	if err := json.Unmarshal(taskRes.Body.Bytes(), &task); err != nil {
		t.Fatalf("failed to parse task: %v", err)
	}

	loc, _ := time.LoadLocation("Asia/Tokyo")
	if loc == nil {
		loc = time.FixedZone("JST", 9*60*60)
	}
	today := time.Now().In(loc).Format("2006-01-02")

	increment := func() api.TaskCompletionResponse {
		req := `{"targetDate":"` + today + `","action":"increment"}`
		res := doRequest(t, r, http.MethodPost, "/v1/tasks/"+task.Id+"/completions/toggle", req, token)
		if res.Code != http.StatusOK {
			t.Fatalf("increment expected 200, got %d: %s", res.Code, res.Body.String())
		}
		var body api.TaskCompletionResponse
		if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
			t.Fatalf("failed to parse increment response: %v", err)
		}
		return body
	}

	decrement := func() api.TaskCompletionResponse {
		req := `{"targetDate":"` + today + `","action":"decrement"}`
		res := doRequest(t, r, http.MethodPost, "/v1/tasks/"+task.Id+"/completions/toggle", req, token)
		if res.Code != http.StatusOK {
			t.Fatalf("decrement expected 200, got %d: %s", res.Code, res.Body.String())
		}
		var body api.TaskCompletionResponse
		if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
			t.Fatalf("failed to parse decrement response: %v", err)
		}
		return body
	}

	if c := increment().WeeklyCompletedCount; c != 1 {
		t.Fatalf("expected count 1, got %d", c)
	}
	if c := increment().WeeklyCompletedCount; c != 2 {
		t.Fatalf("expected count 2, got %d", c)
	}
	if c := increment().WeeklyCompletedCount; c != 3 {
		t.Fatalf("expected count 3, got %d", c)
	}
	if c := increment().WeeklyCompletedCount; c != 3 {
		t.Fatalf("expected count to stay 3, got %d", c)
	}

	if c := decrement().WeeklyCompletedCount; c != 2 {
		t.Fatalf("expected count 2, got %d", c)
	}
	if c := decrement().WeeklyCompletedCount; c != 1 {
		t.Fatalf("expected count 1, got %d", c)
	}
	if c := decrement().WeeklyCompletedCount; c != 0 {
		t.Fatalf("expected count 0, got %d", c)
	}
	if c := decrement().WeeklyCompletedCount; c != 0 {
		t.Fatalf("expected count to stay 0, got %d", c)
	}
}

func TestWeeklyTaskWithSingleRequiredRejectsIncrement(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	taskRes := doRequest(t, r, http.MethodPost, "/v1/tasks", `{"title":"皿洗い","type":"weekly","penaltyPoints":2,"requiredCompletionsPerWeek":1}`, token)
	if taskRes.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", taskRes.Code, taskRes.Body.String())
	}

	var task api.Task
	if err := json.Unmarshal(taskRes.Body.Bytes(), &task); err != nil {
		t.Fatalf("failed to parse task: %v", err)
	}

	loc, _ := time.LoadLocation("Asia/Tokyo")
	if loc == nil {
		loc = time.FixedZone("JST", 9*60*60)
	}
	today := time.Now().In(loc).Format("2006-01-02")

	req := `{"targetDate":"` + today + `","action":"increment"}`
	res := doRequest(t, r, http.MethodPost, "/v1/tasks/"+task.Id+"/completions/toggle", req, token)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", res.Code, res.Body.String())
	}
}

func TestWeeklyTaskToggleWithoutActionDefaultsToIncrement(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	taskRes := doRequest(t, r, http.MethodPost, "/v1/tasks", `{"title":"風呂掃除","type":"weekly","penaltyPoints":2,"requiredCompletionsPerWeek":3}`, token)
	if taskRes.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", taskRes.Code, taskRes.Body.String())
	}

	var task api.Task
	if err := json.Unmarshal(taskRes.Body.Bytes(), &task); err != nil {
		t.Fatalf("failed to parse task: %v", err)
	}

	loc, _ := time.LoadLocation("Asia/Tokyo")
	if loc == nil {
		loc = time.FixedZone("JST", 9*60*60)
	}
	today := time.Now().In(loc).Format("2006-01-02")

	toggleWithoutAction := func() api.TaskCompletionResponse {
		req := `{"targetDate":"` + today + `"}`
		res := doRequest(t, r, http.MethodPost, "/v1/tasks/"+task.Id+"/completions/toggle", req, token)
		if res.Code != http.StatusOK {
			t.Fatalf("toggle expected 200, got %d: %s", res.Code, res.Body.String())
		}
		var body api.TaskCompletionResponse
		if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
			t.Fatalf("failed to parse toggle response: %v", err)
		}
		return body
	}

	if c := toggleWithoutAction().WeeklyCompletedCount; c != 1 {
		t.Fatalf("expected count 1, got %d", c)
	}
	if c := toggleWithoutAction().WeeklyCompletedCount; c != 2 {
		t.Fatalf("expected count 2, got %d", c)
	}
}

func TestWeeklyTaskIncrementIsAtomicUnderConcurrency(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	const maxRequiredCompletionsPerWeek = 7
	const workers = 20
	createTaskReq := fmt.Sprintf(
		`{"title":"洗濯","type":"weekly","penaltyPoints":2,"requiredCompletionsPerWeek":%d}`,
		maxRequiredCompletionsPerWeek,
	)
	taskRes := doRequest(t, r, http.MethodPost, "/v1/tasks", createTaskReq, token)
	if taskRes.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", taskRes.Code, taskRes.Body.String())
	}

	var task api.Task
	if err := json.Unmarshal(taskRes.Body.Bytes(), &task); err != nil {
		t.Fatalf("failed to parse task: %v", err)
	}

	loc, _ := time.LoadLocation("Asia/Tokyo")
	if loc == nil {
		loc = time.FixedZone("JST", 9*60*60)
	}
	today := time.Now().In(loc).Format("2006-01-02")
	req := `{"targetDate":"` + today + `","action":"increment"}`

	start := make(chan struct{})
	successCh := make(chan struct{}, workers)
	preconditionCh := make(chan struct{}, workers)
	errCh := make(chan string, workers)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			res := doRequest(t, r, http.MethodPost, "/v1/tasks/"+task.Id+"/completions/toggle", req, token)
			switch res.Code {
			case http.StatusOK:
				successCh <- struct{}{}
			case http.StatusPreconditionFailed:
				preconditionCh <- struct{}{}
			default:
				errCh <- "increment request failed"
			}
		}()
	}
	close(start)
	wg.Wait()
	close(errCh)
	for msg := range errCh {
		t.Fatal(msg)
	}
	close(successCh)
	close(preconditionCh)
	successCount := len(successCh)
	preconditionCount := len(preconditionCh)
	if successCount == 0 {
		t.Fatalf("expected at least one successful increment")
	}
	if preconditionCount == 0 {
		t.Fatalf("expected some precondition failures under concurrent stale writes")
	}

	overviewRes := doRequest(t, r, http.MethodGet, "/v1/tasks/overview", "", token)
	if overviewRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", overviewRes.Code, overviewRes.Body.String())
	}
	var overview api.TaskOverviewResponse
	if err := json.Unmarshal(overviewRes.Body.Bytes(), &overview); err != nil {
		t.Fatalf("failed to parse task overview: %v", err)
	}

	for _, item := range overview.WeeklyTasks {
		if item.Task.Id == task.Id {
			expectedCount := successCount
			if expectedCount > maxRequiredCompletionsPerWeek {
				expectedCount = maxRequiredCompletionsPerWeek
			}
			if item.WeekCompletedCount != expectedCount {
				t.Fatalf("expected weekly count %d, got %d", expectedCount, item.WeekCompletedCount)
			}
			return
		}
	}
	t.Fatalf("weekly task not found in overview")
}

func TestProtectedWriteRejectsInvalidOrigin(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	req := httptest.NewRequest(http.MethodPost, "/v1/teams/invites", strings.NewReader(`{"expiresInHours":72}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.example")
	req.AddCookie(&http.Cookie{Name: "kaji_session", Value: token})

	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", res.Code, res.Body.String())
	}
}

func TestProtectedGetReturnsETag(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	res := doRequest(t, r, http.MethodGet, "/v1/me", "", token)
	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
	}
	if etag := strings.TrimSpace(res.Header().Get("ETag")); etag == "" {
		t.Fatalf("expected ETag header")
	}
}

func TestWriteRejectsIfMatchMismatch(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	req := httptest.NewRequest(http.MethodPost, "/v1/tasks", strings.NewReader(`{"title":"掃除","type":"daily","penaltyPoints":2}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("If-Match", `W/"team:dummy:rev:999999"`)
	req.AddCookie(&http.Cookie{Name: "kaji_session", Value: token})
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)
	if res.Code != http.StatusPreconditionFailed {
		t.Fatalf("expected 412, got %d: %s", res.Code, res.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if body["code"] != "precondition_failed" {
		t.Fatalf("expected precondition_failed code, got %q", body["code"])
	}
	if strings.TrimSpace(body["currentEtag"]) == "" {
		t.Fatalf("expected currentEtag in response")
	}
}

func TestWriteRejectsMissingIfMatch(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	req := httptest.NewRequest(http.MethodPost, "/v1/tasks", strings.NewReader(`{"title":"掃除","type":"daily","penaltyPoints":2}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://localhost:5173")
	req.AddCookie(&http.Cookie{Name: "kaji_session", Value: token})
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)
	if res.Code != http.StatusPreconditionRequired {
		t.Fatalf("expected 428, got %d: %s", res.Code, res.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if body["code"] != "precondition_required" {
		t.Fatalf("expected precondition_required code, got %q", body["code"])
	}
}

func TestSessionExchangeRequiresOrigin(t *testing.T) {
	r := newTestRouter(t)

	startRes := doRequest(t, r, http.MethodGet, "/v1/auth/google/start", "", "")
	if startRes.Code != http.StatusOK {
		t.Fatalf("auth start failed: %d %s", startRes.Code, startRes.Body.String())
	}
	var start api.AuthStartResponse
	if err := json.Unmarshal(startRes.Body.Bytes(), &start); err != nil {
		t.Fatalf("failed to parse auth start response: %v", err)
	}
	u, err := url.Parse(start.AuthorizationUrl)
	if err != nil {
		t.Fatalf("failed to parse authorization url: %v", err)
	}
	callbackRes := doRequest(t, r, http.MethodGet, u.RequestURI(), "", "")
	if callbackRes.Code != http.StatusOK && callbackRes.Code != http.StatusFound {
		t.Fatalf("auth callback failed: %d %s", callbackRes.Code, callbackRes.Body.String())
	}
	exchangeCode := ""
	if callbackRes.Code == http.StatusFound {
		locURL, err := url.Parse(callbackRes.Header().Get("Location"))
		if err != nil {
			t.Fatalf("failed to parse callback redirect location: %v", err)
		}
		exchangeCode = locURL.Query().Get("exchangeCode")
	} else {
		var callback api.AuthCallbackResponse
		if err := json.Unmarshal(callbackRes.Body.Bytes(), &callback); err != nil {
			t.Fatalf("failed to parse callback response: %v", err)
		}
		exchangeCode = callback.ExchangeCode
	}
	if exchangeCode == "" {
		t.Fatalf("expected exchange code from callback")
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/auth/sessions/exchange", strings.NewReader(`{"exchangeCode":"`+exchangeCode+`"}`))
	req.Header.Set("Content-Type", "application/json")
	// no Origin header on purpose
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", res.Code, res.Body.String())
	}
}

func login(t *testing.T, r http.Handler) string {
	return loginAs(t, r, "test-user@example.com")
}

func loginAs(t *testing.T, r http.Handler, email string) string {
	t.Helper()

	callbackRes := startGoogleAuthCallbackWithMockEmail(t, r, email)
	if callbackRes.Code != http.StatusOK && callbackRes.Code != http.StatusFound {
		t.Fatalf("auth callback failed: %d %s", callbackRes.Code, callbackRes.Body.String())
	}

	exchangeCode := ""
	if callbackRes.Code == http.StatusFound {
		location := callbackRes.Header().Get("Location")
		locURL, err := url.Parse(location)
		if err != nil {
			t.Fatalf("failed to parse callback redirect location: %v", err)
		}
		exchangeCode = locURL.Query().Get("exchangeCode")
	} else {
		var callback api.AuthCallbackResponse
		if err := json.Unmarshal(callbackRes.Body.Bytes(), &callback); err != nil {
			t.Fatalf("failed to parse callback response: %v", err)
		}
		exchangeCode = callback.ExchangeCode
	}
	if exchangeCode == "" {
		t.Fatalf("expected exchange code from callback")
	}

	exchangeReq := `{"exchangeCode":"` + exchangeCode + `"}`
	exchangeRes := doRequest(t, r, http.MethodPost, "/v1/auth/sessions/exchange", exchangeReq, "")
	if exchangeRes.Code != http.StatusOK {
		t.Fatalf("exchange failed: %d %s", exchangeRes.Code, exchangeRes.Body.String())
	}

	cookies := exchangeRes.Result().Cookies()
	for _, cookie := range cookies {
		if cookie.Name == "kaji_session" && cookie.Value != "" {
			return cookie.Value
		}
	}
	t.Fatalf("expected kaji_session cookie in exchange response")
	return ""
}

func startGoogleAuthCallbackWithMockEmail(t *testing.T, r http.Handler, email string) *httptest.ResponseRecorder {
	t.Helper()

	startRes := doRequest(t, r, http.MethodGet, "/v1/auth/google/start", "", "")
	if startRes.Code != http.StatusOK {
		t.Fatalf("auth start failed: %d %s", startRes.Code, startRes.Body.String())
	}

	var start api.AuthStartResponse
	if err := json.Unmarshal(startRes.Body.Bytes(), &start); err != nil {
		t.Fatalf("failed to parse auth start response: %v", err)
	}

	u, err := url.Parse(start.AuthorizationUrl)
	if err != nil {
		t.Fatalf("failed to parse authorization url: %v", err)
	}
	q := u.Query()
	q.Set("mock_email", email)
	q.Set("mock_name", "Test User")
	u.RawQuery = q.Encode()
	return doRequest(t, r, http.MethodGet, u.RequestURI(), "", "")
}

func fetchMeUserID(t *testing.T, r http.Handler, token string) string {
	t.Helper()

	res := doRequest(t, r, http.MethodGet, "/v1/me", "", token)
	if res.Code != http.StatusOK {
		t.Fatalf("expected 200 from /v1/me, got %d: %s", res.Code, res.Body.String())
	}
	var me api.MeResponse
	if err := json.Unmarshal(res.Body.Bytes(), &me); err != nil {
		t.Fatalf("failed to parse /v1/me response: %v", err)
	}
	return me.User.Id
}

func clearTeamMembershipsForTest(t *testing.T, userID string) {
	t.Helper()

	dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dbURL == "" {
		t.Fatalf("DATABASE_URL is required")
	}
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer db.Close()

	if _, err := db.Exec(`DELETE FROM team_members WHERE user_id = $1`, userID); err != nil {
		t.Fatalf("failed to clear team memberships: %v", err)
	}
}

func doRequest(t *testing.T, r http.Handler, method, path, body, sessionCookie string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if sessionCookie != "" {
		req.AddCookie(&http.Cookie{Name: "kaji_session", Value: sessionCookie})
	}
	if method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch || method == http.MethodDelete {
		req.Header.Set("Origin", "http://localhost:5173")
		if sessionCookie != "" && !strings.HasPrefix(path, "/v1/auth/") {
			if etag := fetchLatestETag(t, r, sessionCookie); etag != "" {
				req.Header.Set("If-Match", etag)
			}
		}
	}
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)
	return res
}

func fetchLatestETag(t *testing.T, r http.Handler, sessionCookie string) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	req.AddCookie(&http.Cookie{Name: "kaji_session", Value: sessionCookie})
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		return ""
	}
	return strings.TrimSpace(res.Header().Get("ETag"))
}

func expireSessionForTest(t *testing.T, rawToken string) {
	t.Helper()

	dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dbURL == "" {
		t.Fatalf("DATABASE_URL is required")
	}
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer db.Close()

	hashed := hashTokenForTest(rawToken)
	result, err := db.Exec(`UPDATE sessions SET expires_at = NOW() - INTERVAL '1 minute' WHERE token = $1`, hashed)
	if err != nil {
		t.Fatalf("failed to expire session: %v", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		t.Fatalf("failed to get affected rows: %v", err)
	}
	if rows != 1 {
		t.Fatalf("expected one affected session row, got %d", rows)
	}
}

func hashTokenForTest(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func newTestRouter(t *testing.T) *gin.Engine {
	t.Helper()
	t.Setenv("DATABASE_URL", dbtest.IsolatedDatabaseURL(t))
	t.Setenv("OIDC_STRICT_MODE", "false")
	t.Setenv("OIDC_ISSUER_URL", "")
	t.Setenv("OIDC_CLIENT_ID", "")
	t.Setenv("OIDC_CLIENT_SECRET", "")
	t.Setenv("OIDC_REDIRECT_URL", "")
	t.Setenv("SIGNUP_GUARD_ENABLED", "false")
	t.Setenv("SIGNUP_ALLOWED_EMAILS", "")
	t.Setenv("FRONTEND_CALLBACK_URL", "")
	return NewRouter()
}
