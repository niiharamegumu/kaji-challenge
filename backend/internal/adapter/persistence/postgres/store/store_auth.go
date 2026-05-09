package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"time"

	oidcauth "github.com/megu/kaji-challenge/backend/internal/adapter/external/oidc"
	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	"github.com/megu/kaji-challenge/backend/internal/application/ports"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
)

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

const maxSessionsPerUser int32 = 5

const trimSessionsForUserQuery = `
WITH stale_sessions AS (
  SELECT token
  FROM sessions
  WHERE user_id = $1
  ORDER BY created_at DESC, token DESC
  OFFSET $2
)
DELETE FROM sessions
WHERE token IN (SELECT token FROM stale_sessions);
`

func defaultTrimSessionsForUserExec(ctx context.Context, exec dbsqlc.DBTX, userID string, keepCount int32) error {
	_, err := exec.Exec(ctx, trimSessionsForUserQuery, userID, keepCount)
	return err
}

func (s *Store) LookupSession(ctx context.Context, token string) (string, bool) {
	rec, err := s.q.GetSessionByToken(ctx, hashToken(token))
	if err != nil {
		return "", false
	}
	return rec.UserID, true
}

func (s *Store) StartGoogleAuth(ctx context.Context) (model.AuthStartResponse, error) {
	state, err := randomToken()
	if err != nil {
		return model.AuthStartResponse{}, err
	}
	nonce, err := randomToken()
	if err != nil {
		return model.AuthStartResponse{}, err
	}
	verifier, err := randomToken()
	if err != nil {
		return model.AuthStartResponse{}, err
	}
	expiresAt := time.Now().In(s.loc).Add(10 * time.Minute)
	if s.q != nil {
		if err := s.q.InsertAuthRequest(ctx, dbsqlc.InsertAuthRequestParams{
			State:        state,
			Nonce:        nonce,
			CodeVerifier: verifier,
			ExpiresAt:    toPgTimestamptz(expiresAt),
		}); err != nil {
			return model.AuthStartResponse{}, err
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
		return model.AuthStartResponse{}, err
	}
	return model.AuthStartResponse{AuthorizationUrl: authURL}, nil
}

func (s *Store) CompleteGoogleAuth(ctx context.Context, code, state, mockEmail, mockName, mockSub, mockIss string) (string, string, error) {
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
	issuer := strings.TrimSpace(mockIss)
	if oidcauth.StrictMode() && (email != "" || name != "" || sub != "" || issuer != "") {
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
		issuer = strings.TrimSpace(claims.Iss)
	}

	if email == "" {
		return "", "", errors.New("email not available from provider")
	}
	if sub == "" {
		return "", "", errors.New("sub not available from provider")
	}
	if issuer == "" {
		issuer = "https://mock-issuer.local"
	}
	if name == "" {
		name = strings.Split(email, "@")[0]
	}

	s.mu.Lock()
	userID, user, getErr := s.getOrCreateUserLocked(ctx, issuer, sub, email, name)
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

func (s *Store) exchangeAndVerifyIDToken(ctx context.Context, code string, req authRequest) (oidcauth.Claims, error) {
	s.mu.Lock()
	client, err := s.ensureOIDCClientLocked(ctx)
	s.mu.Unlock()
	if err != nil {
		return oidcauth.Claims{}, err
	}
	return client.ExchangeAndVerify(ctx, code, req.CodeVerifier)
}

func (s *Store) buildAuthorizationURLLocked(ctx context.Context, state, nonce, verifier string) (string, error) {
	if !oidcauth.Configured() {
		if oidcauth.StrictMode() {
			return "", errors.New("OIDC_STRICT_MODE=true requires OIDC configuration")
		}
		return oidcauth.MockAuthorizationURL(state), nil
	}
	client, err := s.ensureOIDCClientLocked(ctx)
	if err != nil {
		return "", err
	}
	return client.AuthorizationURL(state, nonce, verifier), nil
}

func (s *Store) ensureOIDCClientLocked(ctx context.Context) (*oidcauth.Client, error) {
	if s.oidc != nil {
		return s.oidc, nil
	}
	client, err := oidcauth.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	s.oidc = client
	return s.oidc, nil
}

func validateOIDCSettings() error {
	return oidcauth.ValidateSettings()
}

func (s *Store) ExchangeSession(ctx context.Context, exchangeCode string) (ports.AuthSession, error) {
	rec, err := s.q.GetExchangeCode(ctx, exchangeCode)
	if err != nil {
		return ports.AuthSession{}, errors.New("invalid exchange code")
	}
	if rec.UsedAt.Valid || time.Now().In(s.loc).After(rec.ExpiresAt.Time.In(s.loc)) {
		_ = s.q.ConsumeExchangeCode(ctx, exchangeCode)
		return ports.AuthSession{}, errors.New("exchange code expired")
	}
	userRow, err := s.q.GetUserByID(ctx, rec.UserID)
	if err != nil {
		return ports.AuthSession{}, errors.New("user not found")
	}
	rawToken, err := randomToken()
	if err != nil {
		return ports.AuthSession{}, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return ports.AuthSession{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	qtx := s.q.WithTx(tx)

	if err := qtx.ConsumeExchangeCode(ctx, exchangeCode); err != nil {
		return ports.AuthSession{}, errors.New("exchange code expired")
	}
	hashedToken := hashToken(rawToken)
	if err := qtx.CreateSession(ctx, dbsqlc.CreateSessionParams{
		Token:  hashedToken,
		UserID: rec.UserID,
	}); err != nil {
		return ports.AuthSession{}, err
	}
	if err := s.trimSessionsForUser(ctx, tx, rec.UserID, maxSessionsPerUser); err != nil {
		return ports.AuthSession{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ports.AuthSession{}, err
	}
	user := userRecord{
		ID:        userRow.ID,
		Email:     userRow.Email,
		Name:      userRow.DisplayName,
		CreatedAt: userRow.CreatedAt.Time.In(s.loc),
	}
	return ports.AuthSession{Token: rawToken, User: user.toAPI()}, nil
}

func (s *Store) RevokeSession(ctx context.Context, token string) {
	_ = s.q.DeleteSession(ctx, hashToken(token))
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (s *Store) trimSessionsForUser(ctx context.Context, exec dbsqlc.DBTX, userID string, keepCount int32) error {
	if s.trimSessionsForUserExec == nil {
		return defaultTrimSessionsForUserExec(ctx, exec, userID, keepCount)
	}
	return s.trimSessionsForUserExec(ctx, exec, userID, keepCount)
}
