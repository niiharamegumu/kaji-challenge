package store

import (
	"context"
	"testing"
	"time"
)

func TestAuthRequestLifecycle(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Now().In(s.loc)

	if err := s.CreateAuthRequest(ctx, "state-ok", "nonce-1", "verifier-1", now.Add(time.Hour)); err != nil {
		t.Fatalf("CreateAuthRequest failed: %v", err)
	}
	req, err := s.ConsumeAuthRequest(ctx, "state-ok", now)
	if err != nil {
		t.Fatalf("ConsumeAuthRequest failed: %v", err)
	}
	if req.Nonce != "nonce-1" || req.CodeVerifier != "verifier-1" {
		t.Fatalf("unexpected auth request: %+v", req)
	}
	if _, err := s.ConsumeAuthRequest(ctx, "state-ok", now); err == nil {
		t.Fatal("expected consumed auth request to be invalid")
	}

	if err := s.CreateAuthRequest(ctx, "state-expired", "nonce-2", "verifier-2", now.Add(-time.Minute)); err != nil {
		t.Fatalf("CreateAuthRequest expired failed: %v", err)
	}
	if _, err := s.ConsumeAuthRequest(ctx, "state-expired", now); err == nil {
		t.Fatal("expected expired auth request to fail")
	}
	if _, err := s.ConsumeAuthRequest(ctx, "state-expired", now); err == nil {
		t.Fatal("expected expired auth request to be deleted")
	}
}

func TestExchangeSessionLifecycleAndSessionLimit(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	_, userID := createTeamWithMember(t, s, "auth-store@example.com", time.Now().In(s.loc).Add(-time.Hour))

	firstCode, err := s.CreateExchangeCode(ctx, userID, time.Now().In(s.loc).Add(time.Hour))
	if err != nil {
		t.Fatalf("CreateExchangeCode failed: %v", err)
	}
	firstSession, err := s.ExchangeSession(ctx, firstCode)
	if err != nil {
		t.Fatalf("ExchangeSession failed: %v", err)
	}
	if firstSession.Token == "" {
		t.Fatal("expected raw session token")
	}
	if gotUserID, ok := s.LookupSession(ctx, firstSession.Token); !ok || gotUserID != userID {
		t.Fatalf("LookupSession = (%q, %v), want (%q, true)", gotUserID, ok, userID)
	}
	if _, err := s.ExchangeSession(ctx, firstCode); err == nil {
		t.Fatal("expected reused exchange code to fail")
	}

	s.RevokeSession(ctx, firstSession.Token)
	if _, ok := s.LookupSession(ctx, firstSession.Token); ok {
		t.Fatal("expected revoked session to be invalid")
	}

	tokens := make([]string, 0, maxSessionsPerUser+1)
	for i := 0; i < int(maxSessionsPerUser)+1; i++ {
		code, err := s.CreateExchangeCode(ctx, userID, time.Now().In(s.loc).Add(time.Hour))
		if err != nil {
			t.Fatalf("CreateExchangeCode #%d failed: %v", i, err)
		}
		session, err := s.ExchangeSession(ctx, code)
		if err != nil {
			t.Fatalf("ExchangeSession #%d failed: %v", i, err)
		}
		tokens = append(tokens, session.Token)
		time.Sleep(time.Millisecond)
	}

	var sessionCount int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM sessions WHERE user_id = $1`, userID).Scan(&sessionCount); err != nil {
		t.Fatalf("count sessions failed: %v", err)
	}
	if sessionCount != int(maxSessionsPerUser) {
		t.Fatalf("session count = %d, want %d", sessionCount, maxSessionsPerUser)
	}
	validTokens := 0
	for _, token := range tokens {
		if _, ok := s.LookupSession(ctx, token); ok {
			validTokens++
		}
	}
	if validTokens != int(maxSessionsPerUser) {
		t.Fatalf("valid token count = %d, want %d", validTokens, maxSessionsPerUser)
	}
}

func TestExchangeSessionRejectsExpiredCode(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	_, userID := createTeamWithMember(t, s, "expired-code@example.com", time.Now().In(s.loc).Add(-time.Hour))

	code, err := s.CreateExchangeCode(ctx, userID, time.Now().In(s.loc).Add(-time.Minute))
	if err != nil {
		t.Fatalf("CreateExchangeCode failed: %v", err)
	}
	if _, err := s.ExchangeSession(ctx, code); err == nil {
		t.Fatal("expected expired exchange code to fail")
	}
	if _, err := s.ExchangeSession(ctx, code); err == nil {
		t.Fatal("expected consumed expired exchange code to fail")
	}
}
