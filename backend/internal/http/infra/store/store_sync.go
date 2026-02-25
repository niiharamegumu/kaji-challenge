package store

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/megu/kaji-challenge/backend/internal/http/application"
)

type ifMatchContextKey struct{}

func NewIfMatchContext(ctx context.Context, ifMatch string) context.Context {
	return context.WithValue(ctx, ifMatchContextKey{}, strings.TrimSpace(ifMatch))
}

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

func (s *Store) TeamEventStreamForUser(ctx context.Context, userID string) (string, int64, <-chan TeamEvent, func(), error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return "", 0, nil, nil, err
	}
	revision, err := s.q.GetTeamStateRevision(ctx, teamID)
	if err != nil {
		return "", 0, nil, nil, err
	}
	_, stream, cancel := s.eventHub.subscribe(teamID)
	return teamID, revision, stream, cancel, nil
}

func (s *Store) checkIfMatchPrecondition(ctx context.Context, teamID string) error {
	raw, _ := ctx.Value(ifMatchContextKey{}).(string)
	if strings.TrimSpace(raw) == "" {
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

func (s *Store) bumpRevisionAndPublish(ctx context.Context, teamID, entity string, hints map[string]string) (int64, error) {
	revision, err := s.q.IncrementTeamStateRevision(ctx, teamID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil
		}
		return 0, err
	}
	s.eventHub.publish(TeamEvent{
		TeamID:    teamID,
		Entity:    entity,
		Revision:  revision,
		ChangedAt: time.Now().In(s.loc),
		Hints:     hints,
	})
	return revision, nil
}
