package store

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	"github.com/megu/kaji-challenge/backend/internal/application/ports"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	"github.com/megu/kaji-challenge/backend/internal/domain/pushsubscription"
)

func (s *Store) UpsertPushSubscription(ctx context.Context, userID string, req model.UpsertPushSubscriptionRequest) (model.PushSubscription, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return model.PushSubscription{}, err
	}
	sub, err := pushsubscription.Normalize(req.Endpoint, req.Keys.P256dh, req.Keys.Auth, string(req.Platform))
	if err != nil {
		return model.PushSubscription{}, err
	}
	now := s.now()
	row, err := s.q.UpsertPushSubscription(ctx, dbsqlc.UpsertPushSubscriptionParams{
		ID:         s.nextID("push"),
		TeamID:     teamID,
		UserID:     userID,
		Endpoint:   sub.Endpoint,
		P256dh:     sub.P256DH,
		Auth:       sub.Auth,
		Column7:    stringValue(req.UserAgent),
		Platform:   sub.Platform,
		LastSeenAt: toPgTimestamptz(now),
		CreatedAt:  toPgTimestamptz(now),
		UpdatedAt:  toPgTimestamptz(now),
	})
	if err != nil {
		return model.PushSubscription{}, err
	}
	return pushSubscriptionFromUpsertRowToAPI(row, s.loc), nil
}

func (s *Store) DeletePushSubscription(ctx context.Context, userID, subscriptionID string) error {
	rows, err := s.q.DeactivatePushSubscriptionByIDAndUser(ctx, dbsqlc.DeactivatePushSubscriptionByIDAndUserParams{
		ID:        subscriptionID,
		UserID:    userID,
		UpdatedAt: toPgTimestamptz(s.now()),
	})
	if err != nil {
		return err
	}
	if rows == 0 {
		return errors.New("push subscription not found")
	}
	return nil
}

func (s *Store) ListPushSubscriptions(ctx context.Context, userID string) (model.ListPushSubscriptionsResponse, error) {
	rows, err := s.queries(ctx).ListPushSubscriptionsByUserID(ctx, userID)
	if err != nil {
		return model.ListPushSubscriptionsResponse{}, err
	}
	items := make([]model.PushSubscription, 0, len(rows))
	for _, row := range rows {
		items = append(items, pushSubscriptionFromListRowToAPI(row, s.loc))
	}
	return model.ListPushSubscriptionsResponse{
		Items:          items,
		VapidPublicKey: strings.TrimSpace(os.Getenv("VAPID_PUBLIC_KEY")),
	}, nil
}

func (s *Store) ListPushTeamIDs(ctx context.Context) ([]string, error) {
	return s.queries(ctx).ListTeamIDsForPush(ctx)
}

func (s *Store) ListPendingPushTasks(ctx context.Context, teamID string, taskType model.TaskType, now, slotDate time.Time) ([]ports.PendingPushTask, error) {
	rows, err := s.q.ListTasksEffectiveForCloseByTeamAndType(ctx, dbsqlc.ListTasksEffectiveForCloseByTeamAndTypeParams{
		TeamID:    teamID,
		Type:      string(taskType),
		CreatedAt: toPgTimestamptz(now),
	})
	if err != nil {
		return nil, err
	}
	pending := make([]ports.PendingPushTask, 0, len(rows))
	switch taskType {
	case model.TaskTypeDaily:
		completedRows, err := s.q.ListTaskCompletionDailyByTeamAndDate(ctx, dbsqlc.ListTaskCompletionDailyByTeamAndDateParams{
			TeamID:     teamID,
			TargetDate: toPgDate(slotDate),
		})
		if err != nil {
			return nil, err
		}
		completed := make(map[string]bool, len(completedRows))
		for _, row := range completedRows {
			completed[row.TaskID] = true
		}
		for _, row := range rows {
			if completed[row.ID] {
				continue
			}
			pending = append(pending, ports.PendingPushTask{
				ID:        row.ID,
				Title:     row.Title,
				Remaining: 1,
			})
		}
	case model.TaskTypeWeekly:
		weekStart := startOfWeek(slotDate, s.loc)
		countRows, err := s.q.ListTaskCompletionWeeklyCountsByTeamAndWeek(ctx, dbsqlc.ListTaskCompletionWeeklyCountsByTeamAndWeekParams{
			TeamID:    teamID,
			WeekStart: toPgDate(weekStart),
		})
		if err != nil {
			return nil, err
		}
		counts := make(map[string]int, len(countRows))
		for _, row := range countRows {
			counts[row.TaskID] = int(row.CompletionCount)
		}
		for _, row := range rows {
			required := int(row.RequiredCompletionsPerWeek)
			remaining := required - counts[row.ID]
			if remaining <= 0 {
				continue
			}
			pending = append(pending, ports.PendingPushTask{
				ID:        row.ID,
				Title:     row.Title,
				Remaining: remaining,
			})
		}
	default:
		return nil, fmt.Errorf("unsupported task type: %s", taskType)
	}
	return pending, nil
}

func (s *Store) ListActivePushSubscriptions(ctx context.Context, teamID string) ([]ports.PushSubscriptionTarget, error) {
	rows, err := s.queries(ctx).ListActivePushSubscriptionsByTeamID(ctx, teamID)
	if err != nil {
		return nil, err
	}
	items := make([]ports.PushSubscriptionTarget, 0, len(rows))
	for _, row := range rows {
		items = append(items, ports.PushSubscriptionTarget{
			Endpoint: row.Endpoint,
			P256DH:   row.P256dh,
			Auth:     row.Auth,
		})
	}
	return items, nil
}

func (s *Store) DeactivatePushSubscriptionByEndpoint(ctx context.Context, endpoint string, updatedAt time.Time) error {
	_, err := s.queries(ctx).DeactivatePushSubscriptionByEndpoint(ctx, dbsqlc.DeactivatePushSubscriptionByEndpointParams{
		Endpoint:  endpoint,
		UpdatedAt: toPgTimestamptz(updatedAt),
	})
	return err
}

func (s *Store) Now() time.Time {
	return s.now()
}

func pushSubscriptionFromUpsertRowToAPI(row dbsqlc.UpsertPushSubscriptionRow, loc *time.Location) model.PushSubscription {
	return model.PushSubscription{
		Id:         row.ID,
		TeamId:     row.TeamID,
		UserId:     row.UserID,
		Endpoint:   row.Endpoint,
		UserAgent:  stringPtrOrNil(row.UserAgent),
		Platform:   model.PushPlatform(row.Platform),
		IsActive:   row.IsActive,
		LastSeenAt: row.LastSeenAt.Time.In(loc),
		CreatedAt:  row.CreatedAt.Time.In(loc),
		UpdatedAt:  row.UpdatedAt.Time.In(loc),
	}
}

func pushSubscriptionFromListRowToAPI(row dbsqlc.ListPushSubscriptionsByUserIDRow, loc *time.Location) model.PushSubscription {
	return model.PushSubscription{
		Id:         row.ID,
		TeamId:     row.TeamID,
		UserId:     row.UserID,
		Endpoint:   row.Endpoint,
		UserAgent:  stringPtrOrNil(row.UserAgent),
		Platform:   model.PushPlatform(row.Platform),
		IsActive:   row.IsActive,
		LastSeenAt: row.LastSeenAt.Time.In(loc),
		CreatedAt:  row.CreatedAt.Time.In(loc),
		UpdatedAt:  row.UpdatedAt.Time.In(loc),
	}
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func stringPtrOrNil(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

var notifyPlatformIOSSafariPWA = pushsubscription.PlatformIOSSafariPWA
