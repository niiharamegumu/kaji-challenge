package http

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
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
	ownerToken := login(t, r)
	inviteRes := doRequest(t, r, http.MethodPost, "/v1/teams/invites", `{"maxUses":2,"expiresInHours":72}`, ownerToken)
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

	memberToken := login(t, r)
	joinRes := doRequest(t, r, http.MethodPost, "/v1/teams/join", `{"code":"`+invite.Code+`"}`, memberToken)
	if joinRes.Code != http.StatusOK {
		t.Fatalf("expected 200 join, got %d: %s", joinRes.Code, joinRes.Body.String())
	}
}

func TestInviteCreateRotatesCodeByHardDelete(t *testing.T) {
	r := newTestRouter(t)
	ownerToken := loginAs(t, r, "invite-owner-rotate@example.com")

	firstInviteRes := doRequest(t, r, http.MethodPost, "/v1/teams/invites", `{"maxUses":100,"expiresInHours":72}`, ownerToken)
	if firstInviteRes.Code != http.StatusCreated {
		t.Fatalf("expected first invite create 201, got %d: %s", firstInviteRes.Code, firstInviteRes.Body.String())
	}
	var firstInvite api.InviteCodeResponse
	if err := json.Unmarshal(firstInviteRes.Body.Bytes(), &firstInvite); err != nil {
		t.Fatalf("failed to parse first invite response: %v", err)
	}

	secondInviteRes := doRequest(t, r, http.MethodPost, "/v1/teams/invites", `{"maxUses":100,"expiresInHours":72}`, ownerToken)
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

func TestInviteIsSingleUseByHardDelete(t *testing.T) {
	r := newTestRouter(t)
	ownerToken := loginAs(t, r, "invite-owner-single-use@example.com")

	inviteRes := doRequest(t, r, http.MethodPost, "/v1/teams/invites", `{"maxUses":100,"expiresInHours":72}`, ownerToken)
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
	if secondJoinRes.Code < 400 || secondJoinRes.Code >= 500 {
		t.Fatalf("expected second invite join 4xx, got %d: %s", secondJoinRes.Code, secondJoinRes.Body.String())
	}
}

func TestInviteResponseMaxUsesIsOne(t *testing.T) {
	r := newTestRouter(t)
	ownerToken := loginAs(t, r, "invite-owner-max-uses@example.com")

	inviteRes := doRequest(t, r, http.MethodPost, "/v1/teams/invites", `{"maxUses":100,"expiresInHours":72}`, ownerToken)
	if inviteRes.Code != http.StatusCreated {
		t.Fatalf("expected invite create 201, got %d: %s", inviteRes.Code, inviteRes.Body.String())
	}
	var invite api.InviteCodeResponse
	if err := json.Unmarshal(inviteRes.Body.Bytes(), &invite); err != nil {
		t.Fatalf("failed to parse invite response: %v", err)
	}
	if invite.MaxUses != 1 {
		t.Fatalf("expected maxUses to be 1, got %d", invite.MaxUses)
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

	const workers = 20
	taskRes := doRequest(t, r, http.MethodPost, "/v1/tasks", `{"title":"洗濯","type":"weekly","penaltyPoints":2,"requiredCompletionsPerWeek":100}`, token)
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
	errCh := make(chan string, workers)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			res := doRequest(t, r, http.MethodPost, "/v1/tasks/"+task.Id+"/completions/toggle", req, token)
			if res.Code != http.StatusOK {
				errCh <- "increment request failed"
				return
			}
		}()
	}
	close(start)
	wg.Wait()
	close(errCh)
	for msg := range errCh {
		t.Fatal(msg)
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
			if item.WeekCompletedCount != workers {
				t.Fatalf("expected weekly count %d, got %d", workers, item.WeekCompletedCount)
			}
			return
		}
	}
	t.Fatalf("weekly task not found in overview")
}

func TestProtectedWriteRejectsInvalidOrigin(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	req := httptest.NewRequest(http.MethodPost, "/v1/teams/invites", strings.NewReader(`{"maxUses":1}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.example")
	req.AddCookie(&http.Cookie{Name: "kaji_session", Value: token})

	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", res.Code, res.Body.String())
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
	callbackPath := u.RequestURI()
	sep := "&"
	if !strings.Contains(callbackPath, "?") {
		sep = "?"
	}
	callbackPath += sep + "mock_email=" + url.QueryEscape(email) + "&mock_name=" + url.QueryEscape("Test User")
	callbackRes := doRequest(t, r, http.MethodGet, callbackPath, "", "")
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
	}
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)
	return res
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
	return NewRouter()
}
