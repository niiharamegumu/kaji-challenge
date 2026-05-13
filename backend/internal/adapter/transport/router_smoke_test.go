package transport

import (
	"encoding/json"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
	"net/http"
	"testing"
)

func TestHealth(t *testing.T) {
	r := newTestRouter(t)
	res := doRequest(t, r, http.MethodGet, "/health", "", "")
	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.Code)
	}
}

func TestEventsStreamRouteDoesNotExist(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)
	res := doRequest(t, r, http.MethodGet, "/v1/events/stream", "", token)
	if res.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", res.Code)
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
