package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"

	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	model "github.com/megu/kaji-challenge/backend/internal/http/application/model"
	pushsvc "github.com/megu/kaji-challenge/backend/internal/push"
)

type notifySlot string

const (
	notifySlotDaily2100         notifySlot = "daily_2100"
	notifySlotWeeklyPrevSat1900 notifySlot = "weekly_prev_sat_1900"
	notifySlotWeeklyDueSun1000  notifySlot = "weekly_due_sun_1000"
)

type NotifyRunResult struct {
	Processed int
	Sent      int
	Skipped   int
	Failed    int
}

type pendingPushTask struct {
	ID        string
	Title     string
	Remaining int
}

type preparedPushDispatch struct {
	teamID        string
	slotKind      notifySlot
	slotDate      time.Time
	payload       pushsvc.Payload
	subscriptions []dbsqlc.ListActivePushSubscriptionsByTeamIDRow
}

func ParseNotifySlot(raw string) (string, error) {
	slot, err := parseNotifySlot(raw)
	if err != nil {
		return "", err
	}
	return string(slot), nil
}

func parseNotifySlot(raw string) (notifySlot, error) {
	switch notifySlot(strings.TrimSpace(raw)) {
	case notifySlotDaily2100:
		return notifySlotDaily2100, nil
	case notifySlotWeeklyPrevSat1900:
		return notifySlotWeeklyPrevSat1900, nil
	case notifySlotWeeklyDueSun1000:
		return notifySlotWeeklyDueSun1000, nil
	default:
		return "", fmt.Errorf("unsupported notify slot: %s", raw)
	}
}

func (s *Store) UpsertPushSubscription(ctx context.Context, userID string, req model.UpsertPushSubscriptionRequest) (model.PushSubscription, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return model.PushSubscription{}, err
	}
	endpoint := strings.TrimSpace(req.Endpoint)
	if endpoint == "" {
		return model.PushSubscription{}, errors.New("endpoint is required")
	}
	p256dh := strings.TrimSpace(req.Keys.P256dh)
	if p256dh == "" {
		return model.PushSubscription{}, errors.New("keys.p256dh is required")
	}
	auth := strings.TrimSpace(req.Keys.Auth)
	if auth == "" {
		return model.PushSubscription{}, errors.New("keys.auth is required")
	}
	platform := strings.TrimSpace(string(req.Platform))
	if platform != string(notifyPlatformIOSSafariPWA) {
		return model.PushSubscription{}, errors.New("invalid push platform")
	}
	now := s.now()
	row, err := s.q.UpsertPushSubscription(ctx, dbsqlc.UpsertPushSubscriptionParams{
		ID:         s.nextID("push"),
		TeamID:     teamID,
		UserID:     userID,
		Endpoint:   endpoint,
		P256dh:     p256dh,
		Auth:       auth,
		Column7:    stringValue(req.UserAgent),
		Platform:   platform,
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
		VapidPublicKey: pushsvc.PublicKeyFromEnv(),
	}, nil
}

func (s *Store) NotifySlot(ctx context.Context, rawSlot string, sender pushsvc.Sender) (NotifyRunResult, error) {
	slot, err := parseNotifySlot(rawSlot)
	if err != nil {
		return NotifyRunResult{}, err
	}
	if sender == nil {
		return NotifyRunResult{}, errors.New("push sender is required")
	}
	teamIDs, err := s.queries(ctx).ListTeamIDsForPush(ctx)
	if err != nil {
		return NotifyRunResult{}, err
	}
	now := s.now()
	result := NotifyRunResult{}
	var firstErr error
	for _, teamID := range teamIDs {
		result.Processed++
		sent, skip, err := s.notifySlotForTeam(ctx, teamID, slot, now, sender)
		if skip {
			result.Skipped++
			continue
		}
		if err != nil {
			result.Failed++
			if firstErr == nil {
				firstErr = fmt.Errorf("team_id=%s: %w", teamID, err)
			}
			continue
		}
		if sent {
			result.Sent++
		}
	}
	if firstErr != nil {
		return result, firstErr
	}
	return result, nil
}

func (s *Store) notifySlotForTeam(ctx context.Context, teamID string, slot notifySlot, now time.Time, sender pushsvc.Sender) (bool, bool, error) {
	slotDate := slot.targetDate(dateOnly(now, s.loc), s.loc)
	dispatch, skip, err := s.preparePushDispatchAt(ctx, teamID, slot, now, slotDate)
	if err != nil {
		return false, false, err
	}
	if skip {
		return false, true, nil
	}
	err = s.executePushDispatch(ctx, dispatch, sender, now)
	if err != nil {
		return false, false, err
	}
	return true, false, nil
}

func (s *Store) preparePushDispatchAt(ctx context.Context, teamID string, slot notifySlot, now, slotDate time.Time) (preparedPushDispatch, bool, error) {
	tasks, err := s.listPendingTasksForSlot(ctx, teamID, slot, now, slotDate)
	if err != nil {
		return preparedPushDispatch{}, false, err
	}
	if len(tasks) == 0 {
		return preparedPushDispatch{}, true, nil
	}
	subscriptions, err := s.queries(ctx).ListActivePushSubscriptionsByTeamID(ctx, teamID)
	if err != nil {
		return preparedPushDispatch{}, false, err
	}
	if len(subscriptions) == 0 {
		return preparedPushDispatch{}, true, nil
	}
	title, body := buildPushMessage(slot, tasks)
	return preparedPushDispatch{
		teamID:   teamID,
		slotKind: slot,
		slotDate: slotDate,
		payload: pushsvc.Payload{
			Title:    title,
			Body:     body,
			Tag:      fmt.Sprintf("team:%s:%s:%s", teamID, slot, slotDate.Format("2006-01-02")),
			Url:      "/",
			TeamID:   teamID,
			SlotKind: string(slot),
		},
		subscriptions: subscriptions,
	}, false, nil
}

func (s *Store) executePushDispatch(ctx context.Context, dispatch preparedPushDispatch, sender pushsvc.Sender, sentAt time.Time) error {
	q := s.queries(ctx)
	var deliveryErr error
	successCount := 0
	expiredCount := 0
	for _, sub := range dispatch.subscriptions {
		result, err := sender.Send(ctx, pushsvc.Subscription{
			Endpoint: sub.Endpoint,
			P256DH:   sub.P256dh,
			Auth:     sub.Auth,
		}, dispatch.payload)
		logPushDispatchAttempt(dispatch, sub.Endpoint, result, err)
		if result.Expired {
			expiredCount++
			if _, deactivateErr := q.DeactivatePushSubscriptionByEndpoint(ctx, dbsqlc.DeactivatePushSubscriptionByEndpointParams{
				Endpoint:  sub.Endpoint,
				UpdatedAt: toPgTimestamptz(sentAt),
			}); deactivateErr != nil {
				return deactivateErr
			}
			continue
		}
		if err != nil {
			deliveryErr = err
			continue
		}
		successCount++
	}
	if deliveryErr != nil && successCount == 0 && expiredCount == 0 {
		return deliveryErr
	}
	return deliveryErr
}

func logPushDispatchAttempt(dispatch preparedPushDispatch, endpoint string, result pushsvc.Result, err error) {
	u, parseErr := url.Parse(endpoint)
	host := ""
	if parseErr == nil {
		host = u.Host
	}
	endpointHash := sha256.Sum256([]byte(endpoint))
	hashText := hex.EncodeToString(endpointHash[:8])
	bodySuffix := ""
	if result.Body != "" {
		bodySuffix = fmt.Sprintf(" body=%q", result.Body)
	}
	if err != nil {
		log.Printf(
			"push dispatch delivery failed: team_id=%s slot=%s slot_date=%s host=%s endpoint_hash=%s status=%d expired=%t apns_id=%q location=%q retry_after=%q title=%q tag=%q url=%q err=%v%s",
			dispatch.teamID,
			dispatch.slotKind,
			dispatch.slotDate.Format("2006-01-02"),
			host,
			hashText,
			result.StatusCode,
			result.Expired,
			result.APNSID,
			result.Location,
			result.RetryAfter,
			dispatch.payload.Title,
			dispatch.payload.Tag,
			dispatch.payload.Url,
			err,
			bodySuffix,
		)
		return
	}
	if result.Expired {
		log.Printf(
			"push dispatch delivery expired: team_id=%s slot=%s slot_date=%s host=%s endpoint_hash=%s status=%d expired=%t apns_id=%q location=%q retry_after=%q title=%q tag=%q url=%q%s",
			dispatch.teamID,
			dispatch.slotKind,
			dispatch.slotDate.Format("2006-01-02"),
			host,
			hashText,
			result.StatusCode,
			result.Expired,
			result.APNSID,
			result.Location,
			result.RetryAfter,
			dispatch.payload.Title,
			dispatch.payload.Tag,
			dispatch.payload.Url,
			bodySuffix,
		)
		return
	}
	log.Printf(
		"push dispatch delivery accepted: team_id=%s slot=%s slot_date=%s host=%s endpoint_hash=%s status=%d expired=%t apns_id=%q location=%q retry_after=%q title=%q tag=%q url=%q%s",
		dispatch.teamID,
		dispatch.slotKind,
		dispatch.slotDate.Format("2006-01-02"),
		host,
		hashText,
		result.StatusCode,
		result.Expired,
		result.APNSID,
		result.Location,
		result.RetryAfter,
		dispatch.payload.Title,
		dispatch.payload.Tag,
		dispatch.payload.Url,
		bodySuffix,
	)
}

func (s *Store) listPendingTasksForSlot(ctx context.Context, teamID string, slot notifySlot, now, slotDate time.Time) ([]pendingPushTask, error) {
	taskType := slot.taskType()
	rows, err := s.q.ListTasksEffectiveForCloseByTeamAndType(ctx, dbsqlc.ListTasksEffectiveForCloseByTeamAndTypeParams{
		TeamID:    teamID,
		Type:      string(taskType),
		CreatedAt: toPgTimestamptz(now),
	})
	if err != nil {
		return nil, err
	}
	pending := make([]pendingPushTask, 0, len(rows))
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
			pending = append(pending, pendingPushTask{
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
			pending = append(pending, pendingPushTask{
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

func buildPushMessage(slot notifySlot, tasks []pendingPushTask) (string, string) {
	count := len(tasks)
	title := fmt.Sprintf("未完了が%d件あります", count)
	switch slot {
	case notifySlotDaily2100:
		title = fmt.Sprintf("今日の未完了が%d件あります", count)
	case notifySlotWeeklyPrevSat1900, notifySlotWeeklyDueSun1000:
		title = fmt.Sprintf("今週の未完了が%d件あります", count)
	}

	previewLimit := 3
	if len(tasks) < previewLimit {
		previewLimit = len(tasks)
	}
	parts := make([]string, 0, previewLimit+1)
	for _, task := range tasks[:previewLimit] {
		label := task.Title
		if slot.taskType() == model.TaskTypeWeekly && task.Remaining > 1 {
			label = fmt.Sprintf("%s（あと%d回）", task.Title, task.Remaining)
		}
		parts = append(parts, label)
	}
	if remaining := len(tasks) - previewLimit; remaining > 0 {
		parts = append(parts, fmt.Sprintf("ほか%d件", remaining))
	}
	body := taskTypeLabelForSlot(slot)
	if len(parts) > 0 {
		body = fmt.Sprintf("%s\n%s", body, strings.Join(parts, "、"))
	}
	return title, body
}

func taskTypeLabelForSlot(slot notifySlot) string {
	switch slot.taskType() {
	case model.TaskTypeWeekly:
		return "週間タスク"
	default:
		return "日間タスク"
	}
}

func (s notifySlot) targetDate(today time.Time, loc *time.Location) time.Time {
	switch s {
	case notifySlotDaily2100:
		return dateOnly(today, loc)
	case notifySlotWeeklyPrevSat1900, notifySlotWeeklyDueSun1000:
		return startOfWeek(today, loc).AddDate(0, 0, 6)
	default:
		return dateOnly(today, loc)
	}
}

func (s notifySlot) taskType() model.TaskType {
	switch s {
	case notifySlotDaily2100:
		return model.TaskTypeDaily
	default:
		return model.TaskTypeWeekly
	}
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

var notifyPlatformIOSSafariPWA = string(model.PushPlatformIOSSafariWebApp)
