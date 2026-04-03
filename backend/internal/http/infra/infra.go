package infra

import (
	"context"
	"time"

	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	"github.com/megu/kaji-challenge/backend/internal/http/application/ports"
	"github.com/megu/kaji-challenge/backend/internal/http/infra/repositories"
	"github.com/megu/kaji-challenge/backend/internal/http/infra/store"
)

type Store = store.Store
type NotifyRunResult = store.NotifyRunResult

func NewStore() *Store {
	return store.NewStore()
}

func NewServices(s *Store) *ports.Services {
	return repositories.NewServices(s)
}

func ParseNotifySlot(raw string) (string, error) {
	return store.ParseNotifySlot(raw)
}

func RejectMockParamsInStrictModeForTest(ctx context.Context, loc *time.Location) error {
	return store.RejectMockParamsInStrictModeForTest(ctx, loc)
}

func SetTrimSessionsForUserExecForTest(
	fn func(ctx context.Context, exec dbsqlc.DBTX, userID string, keepCount int32) error,
) func() {
	return store.SetTrimSessionsForUserExecForTest(fn)
}
