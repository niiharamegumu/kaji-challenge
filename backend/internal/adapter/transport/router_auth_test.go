package transport

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/megu/kaji-challenge/backend/internal/adapter/persistence/postgres"
	"github.com/megu/kaji-challenge/backend/internal/application/ports"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

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
	_ = NewRouter(&ports.Services{Auth: failingAuthService{}}, nil)
}

type failingAuthService struct{ mockAuthService }

func (failingAuthService) ValidateSettings() error {
	return errors.New("OIDC_STRICT_MODE=true but missing required env vars")
}

func TestNewRouterPanicsWhenSignupGuardEnabledWithoutAllowlist(t *testing.T) {
	t.Setenv("SIGNUP_GUARD_ENABLED", "true")
	t.Setenv("SIGNUP_ALLOWED_EMAILS", "")

	defer func() {
		if recover() == nil {
			t.Fatalf("expected panic when signup guard is enabled without allowlist")
		}
	}()
	_ = postgres.NewStore()
}

func TestCompleteGoogleAuthRejectsMockParamsInStrictMode(t *testing.T) {
	t.Setenv("OIDC_STRICT_MODE", "true")
	loc, _ := time.LoadLocation("Asia/Tokyo")
	if loc == nil {
		loc = time.FixedZone("JST", 9*60*60)
	}

	err := postgres.RejectMockParamsInStrictModeForTest(context.Background(), loc)
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

func TestLoginStoresOIDCIdentity(t *testing.T) {
	r := newTestRouter(t)
	email := "oidc-store@example.com"
	_ = loginAs(t, r, email)

	issuer, subject := fetchUserOIDCIdentityByEmail(t, email)
	if issuer == "" {
		t.Fatalf("expected oidc issuer to be stored")
	}
	if subject == "" {
		t.Fatalf("expected oidc subject to be stored")
	}
}

func TestLoginUsesOIDCIdentityEvenWhenEmailChanges(t *testing.T) {
	r := newTestRouter(t)
	const issuer = "https://mock-issuer.local"
	const sub = "stable-subject"
	emailA := "oidc-primary@example.com"
	emailB := "oidc-secondary@example.com"

	_ = loginAsWithMockIdentity(t, r, emailA, "User A", sub, issuer)
	tokenB := loginAsWithMockIdentity(t, r, emailB, "User B", sub, issuer)

	userCount := countUsersByOIDCIdentity(t, issuer, sub)
	if userCount != 1 {
		t.Fatalf("expected one user for shared oidc identity, got %d", userCount)
	}

	meRes := doRequest(t, r, http.MethodGet, "/v1/me", "", tokenB)
	if meRes.Code != http.StatusOK {
		t.Fatalf("expected /v1/me 200, got %d: %s", meRes.Code, meRes.Body.String())
	}
	var me api.MeResponse
	if err := json.Unmarshal(meRes.Body.Bytes(), &me); err != nil {
		t.Fatalf("failed to parse /v1/me response: %v", err)
	}
	if me.User.Email != emailA {
		t.Fatalf("expected persisted email %q, got %q", emailA, me.User.Email)
	}
}

func TestUsersOIDCIdentityUniqueConstraint(t *testing.T) {
	r := newTestRouter(t)
	const issuer = "https://mock-issuer.local"
	const sub = "shared-subject"
	emailA := "oidc-unique-a@example.com"
	emailB := "oidc-unique-b@example.com"

	_ = loginAsWithMockIdentity(t, r, emailA, "User A", sub, issuer)
	_ = loginAsWithMockIdentity(t, r, emailB, "User B", "sub-b", issuer)

	dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dbURL == "" {
		t.Fatalf("DATABASE_URL is required")
	}
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer func() {
		_ = db.Close()
	}()

	_, err = db.Exec(
		`UPDATE users SET oidc_issuer = $1, oidc_subject = $2, oidc_linked_at = NOW() WHERE LOWER(email) = LOWER($3)`,
		issuer,
		sub,
		emailB,
	)
	if err == nil {
		t.Fatalf("expected unique constraint violation for duplicated oidc identity")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "duplicate key value violates unique constraint") {
		t.Fatalf("expected unique constraint error, got %v", err)
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

func TestLoginAllowsMultipleSessionsForSameUser(t *testing.T) {
	r := newTestRouter(t)
	email := "multi-session@example.com"

	firstToken := loginAs(t, r, email)
	secondToken := loginAs(t, r, email)
	if firstToken == secondToken {
		t.Fatalf("expected new login to rotate session token")
	}

	firstSessionRes := doRequest(t, r, http.MethodGet, "/v1/me", "", firstToken)
	if firstSessionRes.Code != http.StatusOK {
		t.Fatalf("expected first session token to remain valid, got %d: %s", firstSessionRes.Code, firstSessionRes.Body.String())
	}

	newSessionRes := doRequest(t, r, http.MethodGet, "/v1/me", "", secondToken)
	if newSessionRes.Code != http.StatusOK {
		t.Fatalf("expected new session token to be valid, got %d: %s", newSessionRes.Code, newSessionRes.Body.String())
	}

	userID := fetchMeUserID(t, r, secondToken)
	sessionCount := countSessionsByUserID(t, userID)
	if sessionCount != 2 {
		t.Fatalf("expected two session rows for user, got %d", sessionCount)
	}
}

func TestSessionLimitEvictsOldestWhenOverFive(t *testing.T) {
	r := newTestRouter(t)
	email := "session-limit@example.com"

	tokens := make([]string, 0, 6)
	for i := 0; i < 6; i++ {
		tokens = append(tokens, loginAs(t, r, email))
	}

	userID := fetchMeUserID(t, r, tokens[len(tokens)-1])
	sessionCount := countSessionsByUserID(t, userID)
	if sessionCount != 5 {
		t.Fatalf("expected five session rows for user, got %d", sessionCount)
	}

	oldestSessionRes := doRequest(t, r, http.MethodGet, "/v1/me", "", tokens[0])
	if oldestSessionRes.Code != http.StatusUnauthorized {
		t.Fatalf("expected oldest session token to be evicted, got %d: %s", oldestSessionRes.Code, oldestSessionRes.Body.String())
	}

	latestSessionRes := doRequest(t, r, http.MethodGet, "/v1/me", "", tokens[len(tokens)-1])
	if latestSessionRes.Code != http.StatusOK {
		t.Fatalf("expected latest session token to be valid, got %d: %s", latestSessionRes.Code, latestSessionRes.Body.String())
	}
}

func TestExchangeSessionRollsBackWhenTrimFails(t *testing.T) {
	restoreTrim := postgres.SetTrimSessionsFailureForTest(errors.New("forced trim failure"))
	defer restoreTrim()
	r := newTestRouter(t)

	email := "trim-failure@example.com"
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
	if exchangeRes.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 when trim fails, got %d: %s", exchangeRes.Code, exchangeRes.Body.String())
	}

	dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dbURL == "" {
		t.Fatalf("DATABASE_URL is required")
	}
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer func() {
		_ = db.Close()
	}()

	var userID string
	if err := db.QueryRow(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, email).Scan(&userID); err != nil {
		t.Fatalf("failed to find user id by email: %v", err)
	}

	var sessionCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE user_id = $1`, userID).Scan(&sessionCount); err != nil {
		t.Fatalf("failed to count sessions: %v", err)
	}
	if sessionCount != 0 {
		t.Fatalf("expected no persisted sessions after rollback, got %d", sessionCount)
	}

	var usedAt sql.NullTime
	if err := db.QueryRow(`SELECT used_at FROM oauth_exchange_codes WHERE code = $1`, exchangeCode).Scan(&usedAt); err != nil {
		t.Fatalf("failed to fetch exchange code used_at: %v", err)
	}
	if usedAt.Valid {
		t.Fatalf("expected exchange code to remain unconsumed after rollback")
	}
}

func TestSessionsMaxFivePerUserMigrationKeepsLatestFive(t *testing.T) {
	r := newTestRouter(t)
	token := loginAs(t, r, "migration-session@example.com")
	userID := fetchMeUserID(t, r, token)

	dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dbURL == "" {
		t.Fatalf("DATABASE_URL is required")
	}
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer func() {
		_ = db.Close()
	}()

	if _, err := db.Exec(`DROP INDEX IF EXISTS uq_sessions_user_id`); err != nil {
		t.Fatalf("failed to drop session unique index: %v", err)
	}
	if _, err := db.Exec(`DELETE FROM sessions WHERE user_id = $1`, userID); err != nil {
		t.Fatalf("failed to clear sessions: %v", err)
	}

	now := time.Now().UTC()
	sessionSeeds := []struct {
		token     string
		createdAt time.Time
	}{
		{token: hashTokenForTest("legacy-1"), createdAt: now.Add(-7 * time.Hour)},
		{token: hashTokenForTest("legacy-2"), createdAt: now.Add(-6 * time.Hour)},
		{token: hashTokenForTest("legacy-3"), createdAt: now.Add(-5 * time.Hour)},
		{token: hashTokenForTest("legacy-4"), createdAt: now.Add(-4 * time.Hour)},
		{token: hashTokenForTest("legacy-5"), createdAt: now.Add(-3 * time.Hour)},
		{token: hashTokenForTest("legacy-6"), createdAt: now.Add(-2 * time.Hour)},
		{token: hashTokenForTest("legacy-7"), createdAt: now.Add(-1 * time.Hour)},
	}
	for _, item := range sessionSeeds {
		if _, err := db.Exec(
			`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1, $2, $3, NULL)`,
			item.token,
			userID,
			item.createdAt,
		); err != nil {
			t.Fatalf("failed to seed duplicate sessions: %v", err)
		}
	}

	if _, err := db.Exec(`
WITH ranked_sessions AS (
  SELECT token,
         ROW_NUMBER() OVER (
           PARTITION BY user_id
           ORDER BY created_at DESC, token DESC
         ) AS rn
  FROM sessions
)
DELETE FROM sessions AS s
USING ranked_sessions AS r
WHERE s.token = r.token
  AND r.rn > 5;
`); err != nil {
		t.Fatalf("failed to trim sessions to max five: %v", err)
	}

	var sessionCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE user_id = $1`, userID).Scan(&sessionCount); err != nil {
		t.Fatalf("failed to read sessions after trim: %v", err)
	}
	if sessionCount != 5 {
		t.Fatalf("expected five session rows after trim, got %d", sessionCount)
	}

	var remainingOldest time.Time
	if err := db.QueryRow(`SELECT MIN(created_at) FROM sessions WHERE user_id = $1`, userID).Scan(&remainingOldest); err != nil {
		t.Fatalf("failed to read oldest remaining session: %v", err)
	}
	expectedOldest := now.Add(-5 * time.Hour).Truncate(time.Microsecond)
	remainingOldest = remainingOldest.UTC()
	if !remainingOldest.Equal(expectedOldest) {
		t.Fatalf("expected oldest remaining session to be %s, got %s", expectedOldest.Format(time.RFC3339Nano), remainingOldest.Format(time.RFC3339Nano))
	}

	var removedCount int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM sessions WHERE user_id = $1 AND token IN ($2, $3)`,
		userID,
		hashTokenForTest("legacy-1"),
		hashTokenForTest("legacy-2"),
	).Scan(&removedCount); err != nil {
		t.Fatalf("failed to verify removed sessions: %v", err)
	}
	if removedCount != 0 {
		t.Fatalf("expected two oldest sessions to be removed, found %d", removedCount)
	}
}
