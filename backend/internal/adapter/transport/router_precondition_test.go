package transport

import (
	"encoding/json"
	"fmt"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

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

func TestShoppingCreateRejectsMissingIfMatch(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	req := httptest.NewRequest(http.MethodPost, "/v1/shopping-items", strings.NewReader(`{"name":"牛乳"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://localhost:5173")
	req.AddCookie(&http.Cookie{Name: "kaji_session", Value: token})
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", res.Code, res.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if body["msg"] == "" {
		t.Fatalf("expected openapi validation error message")
	}
}

func TestShoppingCreateRejectsStaleIfMatch(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	req := httptest.NewRequest(http.MethodPost, "/v1/shopping-items", strings.NewReader(`{"name":"牛乳"}`))
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
}

func TestShoppingReorderReturnsFreshETagForChainedWrites(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	firstCreate := doRequest(t, r, http.MethodPost, "/v1/shopping-items", `{"name":"牛乳"}`, token)
	if firstCreate.Code != http.StatusCreated {
		t.Fatalf("expected first create 201, got %d: %s", firstCreate.Code, firstCreate.Body.String())
	}
	var firstItem api.ShoppingListItem
	if err := json.Unmarshal(firstCreate.Body.Bytes(), &firstItem); err != nil {
		t.Fatalf("failed to parse first shopping item: %v", err)
	}

	secondCreate := doRequest(t, r, http.MethodPost, "/v1/shopping-items", `{"name":"卵"}`, token)
	if secondCreate.Code != http.StatusCreated {
		t.Fatalf("expected second create 201, got %d: %s", secondCreate.Code, secondCreate.Body.String())
	}
	var secondItem api.ShoppingListItem
	if err := json.Unmarshal(secondCreate.Body.Bytes(), &secondItem); err != nil {
		t.Fatalf("failed to parse second shopping item: %v", err)
	}

	reorderEtag := fetchLatestETag(t, r, token)
	if reorderEtag == "" {
		t.Fatalf("expected latest ETag before reorder")
	}

	reorderReq := httptest.NewRequest(http.MethodPost, "/v1/shopping-items/reorder", strings.NewReader(
		fmt.Sprintf(`{"itemIds":["%s","%s"]}`, secondItem.Id, firstItem.Id),
	))
	reorderReq.Header.Set("Content-Type", "application/json")
	reorderReq.Header.Set("Origin", "http://localhost:5173")
	reorderReq.Header.Set("If-Match", reorderEtag)
	reorderReq.AddCookie(&http.Cookie{Name: "kaji_session", Value: token})
	reorderRes := httptest.NewRecorder()
	r.ServeHTTP(reorderRes, reorderReq)
	if reorderRes.Code != http.StatusOK {
		t.Fatalf("expected reorder 200, got %d: %s", reorderRes.Code, reorderRes.Body.String())
	}

	nextEtag := strings.TrimSpace(reorderRes.Header().Get("ETag"))
	if nextEtag == "" {
		t.Fatalf("expected reorder response to include fresh ETag")
	}
	if nextEtag == reorderEtag {
		t.Fatalf("expected reorder to advance ETag")
	}

	patchReq := httptest.NewRequest(http.MethodPatch, "/v1/shopping-items/"+firstItem.Id, strings.NewReader(`{"notes":"特売"}`))
	patchReq.Header.Set("Content-Type", "application/json")
	patchReq.Header.Set("Origin", "http://localhost:5173")
	patchReq.Header.Set("If-Match", nextEtag)
	patchReq.AddCookie(&http.Cookie{Name: "kaji_session", Value: token})
	patchRes := httptest.NewRecorder()
	r.ServeHTTP(patchRes, patchReq)
	if patchRes.Code != http.StatusOK {
		t.Fatalf("expected chained patch 200, got %d: %s", patchRes.Code, patchRes.Body.String())
	}
}

func TestTaskReorderReturnsFreshETagForChainedWrites(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	firstCreate := doRequest(t, r, http.MethodPost, "/v1/tasks", `{"title":"皿洗い","type":"daily","penaltyPoints":1}`, token)
	if firstCreate.Code != http.StatusCreated {
		t.Fatalf("expected first create 201, got %d: %s", firstCreate.Code, firstCreate.Body.String())
	}
	var firstTask api.Task
	if err := json.Unmarshal(firstCreate.Body.Bytes(), &firstTask); err != nil {
		t.Fatalf("failed to parse first task: %v", err)
	}

	secondCreate := doRequest(t, r, http.MethodPost, "/v1/tasks", `{"title":"洗濯","type":"daily","penaltyPoints":2}`, token)
	if secondCreate.Code != http.StatusCreated {
		t.Fatalf("expected second create 201, got %d: %s", secondCreate.Code, secondCreate.Body.String())
	}
	var secondTask api.Task
	if err := json.Unmarshal(secondCreate.Body.Bytes(), &secondTask); err != nil {
		t.Fatalf("failed to parse second task: %v", err)
	}

	reorderEtag := fetchLatestETag(t, r, token)
	if reorderEtag == "" {
		t.Fatalf("expected latest ETag before reorder")
	}

	reorderReq := httptest.NewRequest(http.MethodPost, "/v1/tasks/reorder", strings.NewReader(
		fmt.Sprintf(`{"taskIds":["%s","%s"]}`, secondTask.Id, firstTask.Id),
	))
	reorderReq.Header.Set("Content-Type", "application/json")
	reorderReq.Header.Set("Origin", "http://localhost:5173")
	reorderReq.Header.Set("If-Match", reorderEtag)
	reorderReq.AddCookie(&http.Cookie{Name: "kaji_session", Value: token})
	reorderRes := httptest.NewRecorder()
	r.ServeHTTP(reorderRes, reorderReq)
	if reorderRes.Code != http.StatusOK {
		t.Fatalf("expected reorder 200, got %d: %s", reorderRes.Code, reorderRes.Body.String())
	}

	nextEtag := strings.TrimSpace(reorderRes.Header().Get("ETag"))
	if nextEtag == "" {
		t.Fatalf("expected reorder response to include fresh ETag")
	}
	if nextEtag == reorderEtag {
		t.Fatalf("expected reorder to advance ETag")
	}

	patchReq := httptest.NewRequest(http.MethodPatch, "/v1/tasks/"+firstTask.Id, strings.NewReader(`{"notes":"夜"}`))
	patchReq.Header.Set("Content-Type", "application/json")
	patchReq.Header.Set("Origin", "http://localhost:5173")
	patchReq.Header.Set("If-Match", nextEtag)
	patchReq.AddCookie(&http.Cookie{Name: "kaji_session", Value: token})
	patchRes := httptest.NewRecorder()
	r.ServeHTTP(patchRes, patchReq)
	if patchRes.Code != http.StatusOK {
		t.Fatalf("expected chained patch 200, got %d: %s", patchRes.Code, patchRes.Body.String())
	}
}

func TestTaskMutationsReturnFreshETagForChainedWrites(t *testing.T) {
	r := newTestRouter(t)
	token := login(t, r)

	initialEtag := fetchLatestETag(t, r, token)
	if initialEtag == "" {
		t.Fatalf("expected initial ETag")
	}

	createReq := httptest.NewRequest(http.MethodPost, "/v1/tasks", strings.NewReader(`{"title":"皿洗い","type":"daily","penaltyPoints":1}`))
	createReq.Header.Set("Content-Type", "application/json")
	createReq.Header.Set("Origin", "http://localhost:5173")
	createReq.Header.Set("If-Match", initialEtag)
	createReq.AddCookie(&http.Cookie{Name: "kaji_session", Value: token})
	createRes := httptest.NewRecorder()
	r.ServeHTTP(createRes, createReq)
	if createRes.Code != http.StatusCreated {
		t.Fatalf("expected create 201, got %d: %s", createRes.Code, createRes.Body.String())
	}

	createEtag := strings.TrimSpace(createRes.Header().Get("ETag"))
	if createEtag == "" || createEtag == initialEtag {
		t.Fatalf("expected create to return advanced ETag, got %q", createEtag)
	}

	var task api.Task
	if err := json.Unmarshal(createRes.Body.Bytes(), &task); err != nil {
		t.Fatalf("failed to parse created task: %v", err)
	}

	patchReq := httptest.NewRequest(http.MethodPatch, "/v1/tasks/"+task.Id, strings.NewReader(`{"notes":"夜"}`))
	patchReq.Header.Set("Content-Type", "application/json")
	patchReq.Header.Set("Origin", "http://localhost:5173")
	patchReq.Header.Set("If-Match", createEtag)
	patchReq.AddCookie(&http.Cookie{Name: "kaji_session", Value: token})
	patchRes := httptest.NewRecorder()
	r.ServeHTTP(patchRes, patchReq)
	if patchRes.Code != http.StatusOK {
		t.Fatalf("expected patch 200, got %d: %s", patchRes.Code, patchRes.Body.String())
	}

	patchEtag := strings.TrimSpace(patchRes.Header().Get("ETag"))
	if patchEtag == "" || patchEtag == createEtag {
		t.Fatalf("expected patch to return advanced ETag, got %q", patchEtag)
	}

	today := time.Now().In(time.FixedZone("JST", 9*60*60)).Format("2006-01-02")
	toggleReq := httptest.NewRequest(http.MethodPost, "/v1/tasks/"+task.Id+"/completions/toggle", strings.NewReader(fmt.Sprintf(`{"targetDate":"%s","action":"toggle"}`, today)))
	toggleReq.Header.Set("Content-Type", "application/json")
	toggleReq.Header.Set("Origin", "http://localhost:5173")
	toggleReq.Header.Set("If-Match", patchEtag)
	toggleReq.AddCookie(&http.Cookie{Name: "kaji_session", Value: token})
	toggleRes := httptest.NewRecorder()
	r.ServeHTTP(toggleRes, toggleReq)
	if toggleRes.Code != http.StatusOK {
		t.Fatalf("expected toggle 200, got %d: %s", toggleRes.Code, toggleRes.Body.String())
	}

	toggleEtag := strings.TrimSpace(toggleRes.Header().Get("ETag"))
	if toggleEtag == "" || toggleEtag == patchEtag {
		t.Fatalf("expected toggle to return advanced ETag, got %q", toggleEtag)
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/tasks/"+task.Id, nil)
	deleteReq.Header.Set("Origin", "http://localhost:5173")
	deleteReq.Header.Set("If-Match", toggleEtag)
	deleteReq.AddCookie(&http.Cookie{Name: "kaji_session", Value: token})
	deleteRes := httptest.NewRecorder()
	r.ServeHTTP(deleteRes, deleteReq)
	if deleteRes.Code != http.StatusNoContent {
		t.Fatalf("expected delete 204, got %d: %s", deleteRes.Code, deleteRes.Body.String())
	}

	deleteEtag := strings.TrimSpace(deleteRes.Header().Get("ETag"))
	if deleteEtag == "" || deleteEtag == toggleEtag {
		t.Fatalf("expected delete to return advanced ETag, got %q", deleteEtag)
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
