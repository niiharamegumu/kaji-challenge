package http

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
	"golang.org/x/oauth2"
)

type oidcClient struct {
	provider    *oidc.Provider
	verifier    *oidc.IDTokenVerifier
	oauthConfig oauth2.Config
}

type authRequest struct {
	Nonce        string
	CodeVerifier string
	ExpiresAt    time.Time
}

type exchangeCodeRecord struct {
	UserID    string
	ExpiresAt time.Time
	Used      bool
}

func (s *store) lookupSession(ctx context.Context, token string) (string, bool) {
	rec, err := s.q.GetSessionByToken(ctx, token)
	if err != nil {
		return "", false
	}
	return rec.UserID, true
}

func (s *store) startGoogleAuth(ctx context.Context) (api.AuthStartResponse, error) {
	state, err := randomToken()
	if err != nil {
		return api.AuthStartResponse{}, err
	}
	nonce, err := randomToken()
	if err != nil {
		return api.AuthStartResponse{}, err
	}
	verifier, err := randomToken()
	if err != nil {
		return api.AuthStartResponse{}, err
	}
	expiresAt := time.Now().In(s.loc).Add(10 * time.Minute)
	if s.q != nil {
		if err := s.q.InsertAuthRequest(ctx, dbsqlc.InsertAuthRequestParams{
			State:        state,
			Nonce:        nonce,
			CodeVerifier: verifier,
			ExpiresAt:    toPgTimestamptz(expiresAt),
		}); err != nil {
			return api.AuthStartResponse{}, err
		}
	} else {
		s.mu.Lock()
		s.authRequests[state] = authRequest{
			Nonce:        nonce,
			CodeVerifier: verifier,
			ExpiresAt:    expiresAt,
		}
		s.mu.Unlock()
	}
	s.mu.Lock()
	authURL, err := s.buildAuthorizationURLLocked(ctx, state, nonce, verifier)
	s.mu.Unlock()
	if err != nil {
		return api.AuthStartResponse{}, err
	}
	return api.AuthStartResponse{AuthorizationUrl: authURL}, nil
}

func (s *store) completeGoogleAuth(ctx context.Context, code, state, mockEmail, mockName, mockSub string) (string, string, error) {
	var req authRequest
	if s.q != nil {
		row, err := s.q.GetAuthRequest(ctx, state)
		if err != nil {
			return "", "", errors.New("invalid state")
		}
		req = authRequest{
			Nonce:        row.Nonce,
			CodeVerifier: row.CodeVerifier,
			ExpiresAt:    row.ExpiresAt.Time.In(s.loc),
		}
		if time.Now().In(s.loc).After(req.ExpiresAt) {
			_ = s.q.DeleteAuthRequest(ctx, state)
			return "", "", errors.New("state expired")
		}
		_ = s.q.DeleteAuthRequest(ctx, state)
	} else {
		s.mu.Lock()
		var ok bool
		req, ok = s.authRequests[state]
		if !ok {
			s.mu.Unlock()
			return "", "", errors.New("invalid state")
		}
		if time.Now().In(s.loc).After(req.ExpiresAt) {
			delete(s.authRequests, state)
			s.mu.Unlock()
			return "", "", errors.New("state expired")
		}
		delete(s.authRequests, state)
		s.mu.Unlock()
	}

	email := strings.TrimSpace(strings.ToLower(mockEmail))
	name := strings.TrimSpace(mockName)
	sub := strings.TrimSpace(mockSub)
	if oidcStrictMode() && (email != "" || name != "" || sub != "") {
		return "", "", errors.New("mock callback params are disabled when OIDC_STRICT_MODE=true")
	}

	if email == "" {
		claims, err := s.exchangeAndVerifyIDToken(ctx, code, req)
		if err != nil {
			return "", "", err
		}
		if claims.Nonce != req.Nonce {
			return "", "", errors.New("nonce mismatch")
		}
		email = strings.TrimSpace(strings.ToLower(claims.Email))
		name = strings.TrimSpace(claims.Name)
		sub = strings.TrimSpace(claims.Sub)
	}

	if email == "" {
		return "", "", errors.New("email not available from provider")
	}
	if name == "" {
		name = strings.Split(email, "@")[0]
	}
	_ = sub

	s.mu.Lock()
	userID, user, getErr := s.getOrCreateUserLocked(ctx, email, name)
	if getErr != nil {
		s.mu.Unlock()
		return "", "", getErr
	}
	exchangeCode, err := randomToken()
	if err != nil {
		s.mu.Unlock()
		return "", "", err
	}
	expiresAt := time.Now().In(s.loc).Add(2 * time.Minute)
	if s.q != nil {
		if err := s.q.InsertExchangeCode(ctx, dbsqlc.InsertExchangeCodeParams{
			Code:      exchangeCode,
			UserID:    userID,
			ExpiresAt: toPgTimestamptz(expiresAt),
		}); err != nil {
			s.mu.Unlock()
			return "", "", err
		}
	} else {
		s.exchangeCodes[exchangeCode] = exchangeCodeRecord{UserID: userID, ExpiresAt: expiresAt}
		s.users[userID] = user
	}
	s.mu.Unlock()

	redirectTo := strings.TrimSpace(os.Getenv("FRONTEND_CALLBACK_URL"))
	return exchangeCode, redirectTo, nil
}

type idTokenClaims struct {
	Sub   string `json:"sub"`
	Email string `json:"email"`
	Name  string `json:"name"`
	Nonce string `json:"nonce"`
}

func (s *store) exchangeAndVerifyIDToken(ctx context.Context, code string, req authRequest) (idTokenClaims, error) {
	s.mu.Lock()
	client, err := s.ensureOIDCClientLocked(ctx)
	s.mu.Unlock()
	if err != nil {
		return idTokenClaims{}, err
	}

	tok, err := client.oauthConfig.Exchange(ctx, code, oauth2.SetAuthURLParam("code_verifier", req.CodeVerifier))
	if err != nil {
		return idTokenClaims{}, fmt.Errorf("oauth exchange failed: %w", err)
	}
	raw, ok := tok.Extra("id_token").(string)
	if !ok || raw == "" {
		return idTokenClaims{}, errors.New("id_token missing")
	}
	verified, err := client.verifier.Verify(ctx, raw)
	if err != nil {
		return idTokenClaims{}, fmt.Errorf("id token verify failed: %w", err)
	}
	var claims idTokenClaims
	if err := verified.Claims(&claims); err != nil {
		return idTokenClaims{}, err
	}
	return claims, nil
}

func (s *store) buildAuthorizationURLLocked(ctx context.Context, state, nonce, verifier string) (string, error) {
	if !oidcConfigured() {
		if oidcStrictMode() {
			return "", errors.New("OIDC_STRICT_MODE=true requires OIDC configuration")
		}
		base := strings.TrimSpace(os.Getenv("APP_BASE_URL"))
		if base == "" {
			base = "http://localhost:8080"
		}
		mockURL := fmt.Sprintf("%s/v1/auth/google/callback?code=mock-code&state=%s&mock_email=%s&mock_name=%s",
			strings.TrimRight(base, "/"),
			url.QueryEscape(state),
			url.QueryEscape("owner@example.com"),
			url.QueryEscape("Owner"),
		)
		return mockURL, nil
	}
	client, err := s.ensureOIDCClientLocked(ctx)
	if err != nil {
		return "", err
	}
	challenge := pkceChallenge(verifier)
	authURL := client.oauthConfig.AuthCodeURL(
		state,
		oauth2.SetAuthURLParam("nonce", nonce),
		oauth2.SetAuthURLParam("code_challenge", challenge),
		oauth2.SetAuthURLParam("code_challenge_method", "S256"),
	)
	return authURL, nil
}

func (s *store) ensureOIDCClientLocked(ctx context.Context) (*oidcClient, error) {
	if s.oidc != nil {
		return s.oidc, nil
	}
	if !oidcConfigured() {
		return nil, errors.New("OIDC is not configured")
	}
	issuer := os.Getenv("OIDC_ISSUER_URL")
	clientID := os.Getenv("OIDC_CLIENT_ID")
	clientSecret := os.Getenv("OIDC_CLIENT_SECRET")
	redirectURL := os.Getenv("OIDC_REDIRECT_URL")
	if redirectURL == "" {
		base := strings.TrimSpace(os.Getenv("APP_BASE_URL"))
		if base == "" {
			base = "http://localhost:8080"
		}
		redirectURL = strings.TrimRight(base, "/") + "/v1/auth/google/callback"
	}
	provider, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, err
	}
	s.oidc = &oidcClient{
		provider: provider,
		verifier: provider.Verifier(&oidc.Config{ClientID: clientID}),
		oauthConfig: oauth2.Config{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			Endpoint:     provider.Endpoint(),
			RedirectURL:  redirectURL,
			Scopes:       []string{oidc.ScopeOpenID, "email", "profile"},
		},
	}
	return s.oidc, nil
}

func oidcConfigured() bool {
	return strings.TrimSpace(os.Getenv("OIDC_ISSUER_URL")) != "" &&
		strings.TrimSpace(os.Getenv("OIDC_CLIENT_ID")) != "" &&
		strings.TrimSpace(os.Getenv("OIDC_CLIENT_SECRET")) != ""
}

func oidcStrictMode() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("OIDC_STRICT_MODE")), "true")
}

func validateOIDCSettings() error {
	if !oidcStrictMode() {
		return nil
	}
	missing := []string{}
	required := map[string]string{
		"OIDC_ISSUER_URL":    strings.TrimSpace(os.Getenv("OIDC_ISSUER_URL")),
		"OIDC_CLIENT_ID":     strings.TrimSpace(os.Getenv("OIDC_CLIENT_ID")),
		"OIDC_CLIENT_SECRET": strings.TrimSpace(os.Getenv("OIDC_CLIENT_SECRET")),
		"OIDC_REDIRECT_URL":  strings.TrimSpace(os.Getenv("OIDC_REDIRECT_URL")),
	}
	for key, value := range required {
		if value == "" {
			missing = append(missing, key)
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		return fmt.Errorf("OIDC_STRICT_MODE=true but missing required env vars: %s", strings.Join(missing, ", "))
	}
	return nil
}

func pkceChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func (s *store) exchangeSession(ctx context.Context, exchangeCode string) (api.AuthSessionResponse, error) {
	rec, err := s.q.GetExchangeCode(ctx, exchangeCode)
	if err != nil {
		return api.AuthSessionResponse{}, errors.New("invalid exchange code")
	}
	if rec.UsedAt.Valid || time.Now().In(s.loc).After(rec.ExpiresAt.Time.In(s.loc)) {
		_ = s.q.ConsumeExchangeCode(ctx, exchangeCode)
		return api.AuthSessionResponse{}, errors.New("exchange code expired")
	}
	userRow, err := s.q.GetUserByID(ctx, rec.UserID)
	if err != nil {
		return api.AuthSessionResponse{}, errors.New("user not found")
	}
	token, err := randomToken()
	if err != nil {
		return api.AuthSessionResponse{}, err
	}
	if err := s.q.ConsumeExchangeCode(ctx, exchangeCode); err != nil {
		return api.AuthSessionResponse{}, errors.New("exchange code expired")
	}
	if err := s.q.CreateSession(ctx, dbsqlc.CreateSessionParams{
		Token:  token,
		UserID: rec.UserID,
	}); err != nil {
		return api.AuthSessionResponse{}, err
	}
	user := userRecord{
		ID:        userRow.ID,
		Email:     userRow.Email,
		Name:      userRow.DisplayName,
		CreatedAt: userRow.CreatedAt.Time.In(s.loc),
	}
	return api.AuthSessionResponse{AccessToken: token, User: user.toAPI()}, nil
}

func (s *store) revokeSession(ctx context.Context, token string) {
	_ = s.q.DeleteSession(ctx, token)
}
