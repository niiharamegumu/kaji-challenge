package store

import (
	"context"
	"errors"
	"os"
	"strings"
	"time"

	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
)

// RejectMockParamsInStrictModeForTest is used by router tests without exposing internal store types.
func RejectMockParamsInStrictModeForTest(ctx context.Context, loc *time.Location) error {
	_ = ctx
	_ = loc
	if strings.EqualFold(strings.TrimSpace(os.Getenv("OIDC_STRICT_MODE")), "true") {
		return errors.New("mock callback params are disabled when OIDC_STRICT_MODE=true")
	}
	return nil
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

// SetTrimSessionsFailureForTest temporarily forces session trimming to fail without exposing sqlc types.
func SetTrimSessionsFailureForTest(err error) func() {
	if err == nil {
		err = errors.New("forced trim failure")
	}
	return SetTrimSessionsForUserExecForTest(
		func(context.Context, dbsqlc.DBTX, string, int32) error {
			return err
		},
	)
}
