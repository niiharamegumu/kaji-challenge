package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
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
	loc, _ := time.LoadLocation(jstTZ)
	if loc == nil {
		loc = time.FixedZone("JST", 9*60*60)
	}

	s := &store{
		loc:          loc,
		authRequests: map[string]authRequest{},
	}
	s.authRequests["state-1"] = authRequest{
		Nonce:        "nonce-1",
		CodeVerifier: "verifier-1",
		ExpiresAt:    time.Now().In(loc).Add(10 * time.Minute),
	}

	_, _, err := s.completeGoogleAuth(context.Background(), "mock-code", "state-1", "owner@example.com", "Owner", "")
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

func TestTaskLifecycleAndHome(t *testing.T) {
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

	toggleReq := `{"targetDate":"` + time.Now().Format("2006-01-02") + `"}`
	toggleRes := doRequest(t, r, http.MethodPost, "/v1/tasks/"+task.Id+"/completions/toggle", toggleReq, token)
	if toggleRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", toggleRes.Code, toggleRes.Body.String())
	}

	homeRes := doRequest(t, r, http.MethodGet, "/v1/home", "", token)
	if homeRes.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", homeRes.Code, homeRes.Body.String())
	}

	var home api.HomeResponse
	if err := json.Unmarshal(homeRes.Body.Bytes(), &home); err != nil {
		t.Fatalf("failed to parse home: %v", err)
	}
	if len(home.DailyTasks) == 0 {
		t.Fatalf("expected at least one daily task in home response")
	}
}

func login(t *testing.T, r http.Handler) string {
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

	var session api.AuthSessionResponse
	if err := json.Unmarshal(exchangeRes.Body.Bytes(), &session); err != nil {
		t.Fatalf("failed to parse exchange response: %v", err)
	}
	return session.AccessToken
}

func doRequest(t *testing.T, r http.Handler, method, path, body, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)
	return res
}

func newTestRouter(t *testing.T) *gin.Engine {
	t.Helper()
	if strings.TrimSpace(os.Getenv("DATABASE_URL")) == "" {
		t.Skip("DATABASE_URL is required for router tests")
	}
	t.Setenv("OIDC_STRICT_MODE", "false")
	t.Setenv("OIDC_ISSUER_URL", "")
	t.Setenv("OIDC_CLIENT_ID", "")
	t.Setenv("OIDC_CLIENT_SECRET", "")
	t.Setenv("OIDC_REDIRECT_URL", "")
	return NewRouter()
}
