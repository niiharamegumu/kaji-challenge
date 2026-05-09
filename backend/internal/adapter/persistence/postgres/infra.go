package postgres

import (
	"context"
	"time"

	"github.com/megu/kaji-challenge/backend/internal/adapter/persistence/postgres/repositories"
	"github.com/megu/kaji-challenge/backend/internal/adapter/persistence/postgres/store"
	"github.com/megu/kaji-challenge/backend/internal/application/ports"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
)

type Store = store.Store

func NewStore() *Store {
	return store.NewStore()
}

func NewServices(s *Store) *ports.Services {
	return repositories.NewServices(s)
}

func RejectMockParamsInStrictModeForTest(ctx context.Context, loc *time.Location) error {
	return store.RejectMockParamsInStrictModeForTest(ctx, loc)
}

func SetTrimSessionsForUserExecForTest(
	fn func(ctx context.Context, exec dbsqlc.DBTX, userID string, keepCount int32) error,
) func() {
	return store.SetTrimSessionsForUserExecForTest(fn)
}

func SetTrimSessionsFailureForTest(err error) func() {
	return store.SetTrimSessionsFailureForTest(err)
}
