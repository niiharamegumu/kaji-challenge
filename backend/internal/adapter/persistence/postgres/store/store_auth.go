package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

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

func (s *Store) CreateAuthRequest(ctx context.Context, state, nonce, codeVerifier string, expiresAt time.Time) error {
	if s.q != nil {
		return s.q.InsertAuthRequest(ctx, dbsqlc.InsertAuthRequestParams{
			State:        state,
			Nonce:        nonce,
			CodeVerifier: codeVerifier,
			ExpiresAt:    toPgTimestamptz(expiresAt.In(s.loc)),
		})
	}
	s.mu.Lock()
	s.authRequests[state] = authRequest{
		Nonce:        nonce,
		CodeVerifier: codeVerifier,
		ExpiresAt:    expiresAt.In(s.loc),
	}
	s.mu.Unlock()
	return nil
}

func (s *Store) ConsumeAuthRequest(ctx context.Context, state string, now time.Time) (ports.AuthRequest, error) {
	var req authRequest
	if s.q != nil {
		row, err := s.q.GetAuthRequest(ctx, state)
		if err != nil {
			return ports.AuthRequest{}, errors.New("invalid state")
		}
		req = authRequest{
			Nonce:        row.Nonce,
			CodeVerifier: row.CodeVerifier,
			ExpiresAt:    row.ExpiresAt.Time.In(s.loc),
		}
		if now.In(s.loc).After(req.ExpiresAt) {
			_ = s.q.DeleteAuthRequest(ctx, state)
			return ports.AuthRequest{}, errors.New("state expired")
		}
		_ = s.q.DeleteAuthRequest(ctx, state)
	} else {
		s.mu.Lock()
		var ok bool
		req, ok = s.authRequests[state]
		if !ok {
			s.mu.Unlock()
			return ports.AuthRequest{}, errors.New("invalid state")
		}
		if now.In(s.loc).After(req.ExpiresAt) {
			delete(s.authRequests, state)
			s.mu.Unlock()
			return ports.AuthRequest{}, errors.New("state expired")
		}
		delete(s.authRequests, state)
		s.mu.Unlock()
	}
	return ports.AuthRequest{Nonce: req.Nonce, CodeVerifier: req.CodeVerifier, ExpiresAt: req.ExpiresAt}, nil
}

func (s *Store) GetOrCreateAuthUser(ctx context.Context, issuer, subject, email, name string) (ports.AuthUserResult, error) {
	s.mu.Lock()
	userID, user, getErr := s.getOrCreateUserLocked(ctx, issuer, subject, email, name)
	if getErr != nil {
		s.mu.Unlock()
		return ports.AuthUserResult{}, getErr
	}
	s.users[userID] = user
	s.mu.Unlock()
	return ports.AuthUserResult{UserID: userID, User: user.toAPI()}, nil
}

func (s *Store) CreateExchangeCode(ctx context.Context, userID string, expiresAt time.Time) (string, error) {
	exchangeCode, err := randomToken()
	if err != nil {
		return "", err
	}
	if s.q != nil {
		if err := s.q.InsertExchangeCode(ctx, dbsqlc.InsertExchangeCodeParams{
			Code:      exchangeCode,
			UserID:    userID,
			ExpiresAt: toPgTimestamptz(expiresAt.In(s.loc)),
		}); err != nil {
			return "", err
		}
	} else {
		s.mu.Lock()
		s.exchangeCodes[exchangeCode] = exchangeCodeRecord{UserID: userID, ExpiresAt: expiresAt.In(s.loc)}
		s.mu.Unlock()
	}
	return exchangeCode, nil
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
