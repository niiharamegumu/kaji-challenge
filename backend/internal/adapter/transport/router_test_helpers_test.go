package transport

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/megu/kaji-challenge/backend/internal/adapter/persistence/postgres"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
	"github.com/megu/kaji-challenge/backend/internal/testutil/dbtest"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
)

func login(t *testing.T, r http.Handler) string {
	return loginAs(t, r, "test-user@example.com")
}

func loginAs(t *testing.T, r http.Handler, email string) string {
	return loginAsWithMockIdentity(t, r, email, "Test User", "mock-sub-"+email, "https://mock-issuer.local")
}

func loginAsWithMockIdentity(t *testing.T, r http.Handler, email, name, sub, iss string) string {
	t.Helper()

	callbackRes := startGoogleAuthCallbackWithMockIdentity(t, r, email, name, sub, iss)
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
	return startGoogleAuthCallbackWithMockIdentity(t, r, email, "Test User", "mock-sub-"+email, "https://mock-issuer.local")
}

func startGoogleAuthCallbackWithMockIdentity(t *testing.T, r http.Handler, email, name, sub, iss string) *httptest.ResponseRecorder {
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
	q.Set("mock_name", name)
	q.Set("mock_sub", sub)
	q.Set("mock_iss", iss)
	u.RawQuery = q.Encode()
	return doRequest(t, r, http.MethodGet, u.RequestURI(), "", "")
}

func fetchUserOIDCIdentityByEmail(t *testing.T, email string) (string, string) {
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

	var issuer, subject sql.NullString
	if err := db.QueryRow(`SELECT oidc_issuer, oidc_subject FROM users WHERE LOWER(email) = LOWER($1)`, email).Scan(&issuer, &subject); err != nil {
		t.Fatalf("failed to load oidc identity: %v", err)
	}
	return issuer.String, subject.String
}

func countUsersByOIDCIdentity(t *testing.T, issuer, subject string) int {
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

	var count int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM users WHERE oidc_issuer = $1 AND oidc_subject = $2`,
		issuer,
		subject,
	).Scan(&count); err != nil {
		t.Fatalf("failed to count users by oidc identity: %v", err)
	}
	return count
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

func countSessionsByUserID(t *testing.T, userID string) int {
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

	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE user_id = $1`, userID).Scan(&count); err != nil {
		t.Fatalf("failed to count sessions: %v", err)
	}
	return count
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
	store := postgres.NewStore()
	return NewRouter(postgres.NewServices(store), store)
}
