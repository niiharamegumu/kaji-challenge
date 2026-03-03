package store

import (
	"context"
	"time"

	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
)

// RejectMockParamsInStrictModeForTest is used by router tests without exposing internal store types.
func RejectMockParamsInStrictModeForTest(ctx context.Context, loc *time.Location) error {
	if loc == nil {
		loc = time.FixedZone("JST", 9*60*60)
	}
	s := &Store{
		loc:          loc,
		authRequests: map[string]authRequest{},
	}
	s.authRequests["state-1"] = authRequest{
		Nonce:        "nonce-1",
		CodeVerifier: "verifier-1",
		ExpiresAt:    time.Now().In(loc).Add(10 * time.Minute),
	}
	_, _, err := s.CompleteGoogleAuth(ctx, "mock-code", "state-1", "owner@example.com", "Owner", "", "")
	return err
}

// SetTrimSessionsForUserExecForTest temporarily overrides trim execution.
func SetTrimSessionsForUserExecForTest(
	fn func(ctx context.Context, exec dbsqlc.DBTX, userID string, keepCount int32) error,
) func() {
	nextStoreTrimSessionsForUserExecMu.Lock()
	original := nextStoreTrimSessionsForUserExecForTest
	nextStoreTrimSessionsForUserExecForTest = fn
	nextStoreTrimSessionsForUserExecMu.Unlock()
	return func() {
		nextStoreTrimSessionsForUserExecMu.Lock()
		nextStoreTrimSessionsForUserExecForTest = original
		nextStoreTrimSessionsForUserExecMu.Unlock()
	}
}
