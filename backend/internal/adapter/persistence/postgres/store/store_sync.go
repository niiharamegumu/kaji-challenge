package store

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/megu/kaji-challenge/backend/internal/application"
	"github.com/megu/kaji-challenge/backend/internal/application/requestcontext"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
)

type txQueriesContextKey struct{}

var errNoStateChange = errors.New("no_state_change")

func etagFromRevision(teamID string, revision int64) string {
	return fmt.Sprintf(`W/"team:%s:rev:%d"`, teamID, revision)
}

func parseRevisionFromETag(etag string) (int64, error) {
	normalized := strings.TrimSpace(etag)
	if normalized == "" {
		return 0, fmt.Errorf("etag is empty")
	}
	normalized = strings.TrimPrefix(normalized, "W/")
	normalized = strings.Trim(normalized, `"`)
	parts := strings.Split(normalized, ":")
	if len(parts) != 4 || parts[0] != "team" || parts[2] != "rev" {
		return 0, fmt.Errorf("invalid etag format")
	}
	revision, err := strconv.ParseInt(parts[3], 10, 64)
	if err != nil || revision < 0 {
		return 0, fmt.Errorf("invalid etag revision")
	}
	return revision, nil
}

func (s *Store) TeamETagForUser(ctx context.Context, userID string) (string, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return "", err
	}
	revision, err := s.q.GetTeamStateRevision(ctx, teamID)
	if err != nil {
		return "", err
	}
	return etagFromRevision(teamID, revision), nil
}

func withTxQueries(ctx context.Context, q *dbsqlc.Queries) context.Context {
	return context.WithValue(ctx, txQueriesContextKey{}, q)
}

func (s *Store) queries(ctx context.Context) *dbsqlc.Queries {
	if q, ok := ctx.Value(txQueriesContextKey{}).(*dbsqlc.Queries); ok && q != nil {
		return q
	}
	return s.q
}

func (s *Store) requireIfMatch(ctx context.Context) (int64, error) {
	raw := requestcontext.IfMatch(ctx)
	if strings.TrimSpace(raw) == "" {
		return 0, &application.PreconditionRequiredError{Message: "If-Match header is required"}
	}
	expectedRevision, err := parseRevisionFromETag(raw)
	if err != nil {
		return 0, &application.PreconditionError{Message: "If-Match header is invalid"}
	}
	return expectedRevision, nil
}

func (s *Store) verifyIfMatchAgainstTeam(ctx context.Context, teamID string, required bool) error {
	raw := requestcontext.IfMatch(ctx)
	if strings.TrimSpace(raw) == "" {
		if required {
			return &application.PreconditionRequiredError{Message: "If-Match header is required"}
		}
		return nil
	}
	expectedRevision, err := parseRevisionFromETag(raw)
	if err != nil {
		return &application.PreconditionError{Message: "If-Match header is invalid"}
	}
	currentRevision, err := s.q.GetTeamStateRevision(ctx, teamID)
	if err != nil {
		return err
	}
	if expectedRevision != currentRevision {
		return &application.PreconditionError{
			Message:     "team state changed; refresh and retry",
			CurrentETag: etagFromRevision(teamID, currentRevision),
		}
	}
	return nil
}

func (s *Store) runWithTeamRevisionCAS(
	ctx context.Context,
	teamID string,
	entity string,
	hints map[string]string,
	mutateFn func(ctx context.Context, qtx *dbsqlc.Queries) error,
) (int64, error) {
	expectedRevision, err := s.requireIfMatch(ctx)
	if err != nil {
		return 0, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	qtx := s.q.WithTx(tx)
	txCtx := withTxQueries(ctx, qtx)

	if err := mutateFn(txCtx, qtx); err != nil {
		if errors.Is(err, errNoStateChange) {
			return 0, nil
		}
		return 0, err
	}

	revision, err := qtx.UpdateTeamStateRevisionIfMatch(ctx, dbsqlc.UpdateTeamStateRevisionIfMatchParams{
		ID:            teamID,
		StateRevision: expectedRevision,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			currentRevision, currentErr := qtx.GetTeamStateRevision(ctx, teamID)
			if currentErr != nil {
				return 0, &application.PreconditionError{Message: "team state changed; refresh and retry"}
			}
			return 0, &application.PreconditionError{
				Message:     "team state changed; refresh and retry",
				CurrentETag: etagFromRevision(teamID, currentRevision),
			}
		}
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}

	return revision, nil
}

func (s *Store) bumpTeamRevisionBestEffort(ctx context.Context, teamID, entity string, hints map[string]string) (int64, error) {
	var lastErr error
	for i := 0; i < 3; i++ {
		currentRevision, err := s.q.GetTeamStateRevision(ctx, teamID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return 0, nil
			}
			lastErr = err
			continue
		}
		revision, err := s.q.UpdateTeamStateRevisionIfMatch(ctx, dbsqlc.UpdateTeamStateRevisionIfMatchParams{
			ID:            teamID,
			StateRevision: currentRevision,
		})
		if err != nil {
			lastErr = err
			continue
		}
		return revision, nil
	}
	if lastErr != nil {
		return 0, lastErr
	}
	return 0, nil
}
