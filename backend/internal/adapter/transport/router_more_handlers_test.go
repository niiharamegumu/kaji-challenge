package transport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func TestReminderHTTPRoutesLifecycleAndErrors(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)
	loc, _ := time.LoadLocation("Asia/Tokyo")
	today := time.Now().In(loc).Format(time.DateOnly)
	tomorrow := time.Now().In(loc).AddDate(0, 0, 1).Format(time.DateOnly)

	createBody := `{"title":"Pay bills","kind":"one_time","startDate":"` + today + `"}`
	createRes := doRequest(t, r, http.MethodPost, "/v1/reminders", createBody, token)
	if createRes.Code != http.StatusCreated {
		t.Fatalf("expected reminder create 201, got %d: %s", createRes.Code, createRes.Body.String())
	}
	var created api.Reminder
	if err := json.Unmarshal(createRes.Body.Bytes(), &created); err != nil {
		t.Fatalf("failed to parse reminder: %v", err)
	}

	listDefsRes := doRequest(t, r, http.MethodGet, "/v1/reminders/list", "", token)
	if listDefsRes.Code != http.StatusOK {
		t.Fatalf("expected definitions 200, got %d: %s", listDefsRes.Code, listDefsRes.Body.String())
	}
	if !strings.Contains(listDefsRes.Body.String(), "Pay bills") {
		t.Fatalf("expected created reminder in definitions: %s", listDefsRes.Body.String())
	}

	listRes := doRequest(t, r, http.MethodGet, "/v1/reminders?from="+today+"&to="+tomorrow, "", token)
	if listRes.Code != http.StatusOK {
		t.Fatalf("expected reminders 200, got %d: %s", listRes.Code, listRes.Body.String())
	}
	if !strings.Contains(listRes.Body.String(), "Pay bills") {
		t.Fatalf("expected created reminder occurrence: %s", listRes.Body.String())
	}

	patchRes := doRequest(t, r, http.MethodPatch, "/v1/reminders/"+created.Id, `{"title":"Pay rent"}`, token)
	if patchRes.Code != http.StatusOK {
		t.Fatalf("expected reminder patch 200, got %d: %s", patchRes.Code, patchRes.Body.String())
	}

	deleteRes := doRequest(t, r, http.MethodDelete, "/v1/reminders/"+created.Id, "", token)
	if deleteRes.Code != http.StatusNoContent {
		t.Fatalf("expected reminder delete 204, got %d: %s", deleteRes.Code, deleteRes.Body.String())
	}
}

func TestPushSubscriptionHTTPRoutesLifecycle(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)
	body := `{"endpoint":"https://push.example.test/device-1","platform":"ios_safari_pwa","keys":{"p256dh":"p256dh-key","auth":"auth-key"},"userAgent":"test-agent"}`

	createRes := doRequest(t, r, http.MethodPost, "/v1/push/subscriptions", body, token)
	if createRes.Code != http.StatusOK {
		t.Fatalf("expected push subscription create 200, got %d: %s", createRes.Code, createRes.Body.String())
	}
	var created api.PushSubscription
	if err := json.Unmarshal(createRes.Body.Bytes(), &created); err != nil {
		t.Fatalf("failed to parse push subscription: %v", err)
	}

	listRes := doRequest(t, r, http.MethodGet, "/v1/push/subscriptions/me", "", token)
	if listRes.Code != http.StatusOK {
		t.Fatalf("expected push subscription list 200, got %d: %s", listRes.Code, listRes.Body.String())
	}
	if !strings.Contains(listRes.Body.String(), created.Id) {
		t.Fatalf("expected created subscription in list: %s", listRes.Body.String())
	}

	deleteRes := doRequest(t, r, http.MethodDelete, "/v1/push/subscriptions/"+created.Id, "", token)
	if deleteRes.Code != http.StatusNoContent {
		t.Fatalf("expected push subscription delete 204, got %d: %s", deleteRes.Code, deleteRes.Body.String())
	}
}

func TestAdminLogoutCORSAndCSRFHTTPRoutes(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	optionsReq := httptest.NewRequest(http.MethodOptions, "/v1/tasks", nil)
	optionsReq.Header.Set("Origin", "http://localhost:5173")
	optionsRes := httptest.NewRecorder()
	r.ServeHTTP(optionsRes, optionsReq)
	if optionsRes.Code != http.StatusNoContent {
		t.Fatalf("expected CORS preflight 204, got %d", optionsRes.Code)
	}
	if got := optionsRes.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("unexpected CORS allow origin: %q", got)
	}

	csrfReq := httptest.NewRequest(http.MethodPost, "/v1/tasks", strings.NewReader(`{"title":"x","type":"daily","penaltyPoints":1}`))
	csrfReq.Header.Set("Content-Type", "application/json")
	csrfReq.AddCookie(&http.Cookie{Name: "kaji_session", Value: token})
	csrfRes := httptest.NewRecorder()
	r.ServeHTTP(csrfRes, csrfReq)
	if csrfRes.Code != http.StatusForbidden {
		t.Fatalf("expected missing origin 403, got %d: %s", csrfRes.Code, csrfRes.Body.String())
	}

	adminReq := httptest.NewRequest(http.MethodPost, "/v1/admin/close-day", nil)
	adminReq.Header.Set("Origin", "http://localhost:5173")
	adminReq.AddCookie(&http.Cookie{Name: "kaji_session", Value: token})
	adminRes := httptest.NewRecorder()
	r.ServeHTTP(adminRes, adminReq)
	if adminRes.Code != http.StatusPreconditionRequired {
		t.Fatalf("expected admin close without If-Match 428, got %d: %s", adminRes.Code, adminRes.Body.String())
	}

	logoutRes := doRequest(t, r, http.MethodPost, "/v1/auth/logout", "", token)
	if logoutRes.Code != http.StatusNoContent {
		t.Fatalf("expected logout 204, got %d: %s", logoutRes.Code, logoutRes.Body.String())
	}
	if got := logoutRes.Header().Values("Set-Cookie"); len(got) == 0 || !strings.Contains(strings.Join(got, ";"), "Max-Age=0") {
		t.Fatalf("expected clearing session cookie, got %v", got)
	}
}
