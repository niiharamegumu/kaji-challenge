package usecases

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

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	"github.com/megu/kaji-challenge/backend/internal/application/ports"
	"github.com/megu/kaji-challenge/backend/internal/domain/notification"
)

func (u pushUsecase) UpsertPushSubscription(ctx context.Context, userID string, req model.UpsertPushSubscriptionRequest) (model.PushSubscription, error) {
	return u.repo.UpsertPushSubscription(ctx, userID, req)
}

func (u pushUsecase) DeletePushSubscription(ctx context.Context, userID, subscriptionID string) error {
	return u.repo.DeletePushSubscription(ctx, userID, subscriptionID)
}

func (u pushUsecase) ListPushSubscriptions(ctx context.Context, userID string) (model.ListPushSubscriptionsResponse, error) {
	return u.repo.ListPushSubscriptions(ctx, userID)
}

func (u pushUsecase) NotifySlot(ctx context.Context, rawSlot string, sender ports.PushSender) (ports.NotifyRunResult, error) {
	slot, err := notification.ParseSlot(rawSlot)
	if err != nil {
		return ports.NotifyRunResult{}, err
	}
	if sender == nil {
		return ports.NotifyRunResult{}, errors.New("push sender is required")
	}
	teamIDs, err := u.repo.ListPushTeamIDs(ctx)
	if err != nil {
		return ports.NotifyRunResult{}, err
	}
	now := u.repo.Now()
	result := ports.NotifyRunResult{}
	var firstErr error
	for _, teamID := range teamIDs {
		result.Processed++
		sent, skip, err := u.notifySlotForTeam(ctx, teamID, slot, now, sender)
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

func (u pushUsecase) notifySlotForTeam(
	ctx context.Context,
	teamID string,
	slot notification.Slot,
	now time.Time,
	sender ports.PushSender,
) (bool, bool, error) {
	slotDate := pushSlotTargetDate(slot, dateOnly(now), now.Location())
	tasks, err := u.repo.ListPendingPushTasks(ctx, teamID, pushSlotTaskType(slot), now, slotDate)
	if err != nil {
		return false, false, err
	}
	if len(tasks) == 0 {
		return false, true, nil
	}
	subscriptions, err := u.repo.ListActivePushSubscriptions(ctx, teamID)
	if err != nil {
		return false, false, err
	}
	if len(subscriptions) == 0 {
		return false, true, nil
	}
	title, body := buildPushMessage(slot, tasks)
	payload := ports.PushPayload{
		Title:    title,
		Body:     body,
		Tag:      fmt.Sprintf("team:%s:%s:%s", teamID, slot, slotDate.Format("2006-01-02")),
		URL:      "/",
		TeamID:   teamID,
		SlotKind: string(slot),
	}
	if err := executePushDispatch(ctx, teamID, slot, slotDate, payload, subscriptions, sender, now, u.repo); err != nil {
		return false, false, err
	}
	return true, false, nil
}

func executePushDispatch(
	ctx context.Context,
	teamID string,
	slot notification.Slot,
	slotDate time.Time,
	payload ports.PushPayload,
	subscriptions []ports.PushSubscriptionTarget,
	sender ports.PushSender,
	sentAt time.Time,
	repo ports.PushRepository,
) error {
	var deliveryErr error
	successCount := 0
	expiredCount := 0
	for _, sub := range subscriptions {
		endpoint := ports.PushSubscriptionEndpoint(sub)
		result, err := sender.Send(ctx, endpoint, payload)
		logPushDispatchAttempt(teamID, slot, slotDate, sub.Endpoint, payload, result, err)
		if result.Expired {
			expiredCount++
			if deactivateErr := repo.DeactivatePushSubscriptionByEndpoint(ctx, sub.Endpoint, sentAt); deactivateErr != nil {
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

func logPushDispatchAttempt(
	teamID string,
	slot notification.Slot,
	slotDate time.Time,
	endpoint string,
	payload ports.PushPayload,
	result ports.PushResult,
	err error,
) {
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
			teamID, slot, slotDate.Format("2006-01-02"), host, hashText, result.StatusCode, result.Expired, result.APNSID, result.Location, result.RetryAfter, payload.Title, payload.Tag, payload.URL, err, bodySuffix,
		)
		return
	}
	if result.Expired {
		log.Printf(
			"push dispatch delivery expired: team_id=%s slot=%s slot_date=%s host=%s endpoint_hash=%s status=%d expired=%t apns_id=%q location=%q retry_after=%q title=%q tag=%q url=%q%s",
			teamID, slot, slotDate.Format("2006-01-02"), host, hashText, result.StatusCode, result.Expired, result.APNSID, result.Location, result.RetryAfter, payload.Title, payload.Tag, payload.URL, bodySuffix,
		)
		return
	}
	log.Printf(
		"push dispatch delivery accepted: team_id=%s slot=%s slot_date=%s host=%s endpoint_hash=%s status=%d expired=%t apns_id=%q location=%q retry_after=%q title=%q tag=%q url=%q%s",
		teamID, slot, slotDate.Format("2006-01-02"), host, hashText, result.StatusCode, result.Expired, result.APNSID, result.Location, result.RetryAfter, payload.Title, payload.Tag, payload.URL, bodySuffix,
	)
}

func buildPushMessage(slot notification.Slot, tasks []ports.PendingPushTask) (string, string) {
	count := len(tasks)
	title := fmt.Sprintf("未完了が%d件あります", count)
	switch slot {
	case notification.SlotDaily2100:
		title = fmt.Sprintf("今日の未完了が%d件あります", count)
	case notification.SlotWeeklyPrevSat1900, notification.SlotWeeklyDueSun1000:
		title = fmt.Sprintf("今週の未完了が%d件あります", count)
	}

	previewLimit := 3
	if len(tasks) < previewLimit {
		previewLimit = len(tasks)
	}
	parts := make([]string, 0, previewLimit+1)
	for _, task := range tasks[:previewLimit] {
		label := task.Title
		if pushSlotTaskType(slot) == model.TaskTypeWeekly && task.Remaining > 1 {
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

func taskTypeLabelForSlot(slot notification.Slot) string {
	switch pushSlotTaskType(slot) {
	case model.TaskTypeWeekly:
		return "週間タスク"
	default:
		return "日間タスク"
	}
}

func pushSlotTargetDate(slot notification.Slot, today time.Time, loc *time.Location) time.Time {
	switch slot {
	case notification.SlotDaily2100:
		return dateOnly(today.In(loc))
	case notification.SlotWeeklyPrevSat1900, notification.SlotWeeklyDueSun1000:
		return startOfWeek(today.In(loc), loc).AddDate(0, 0, 6)
	default:
		return dateOnly(today.In(loc))
	}
}

func pushSlotTaskType(slot notification.Slot) model.TaskType {
	switch slot {
	case notification.SlotDaily2100:
		return model.TaskTypeDaily
	default:
		return model.TaskTypeWeekly
	}
}

func dateOnly(t time.Time) time.Time {
	tt := t.In(t.Location())
	return time.Date(tt.Year(), tt.Month(), tt.Day(), 0, 0, 0, 0, tt.Location())
}

func startOfWeek(t time.Time, loc *time.Location) time.Time {
	tt := dateOnly(t.In(loc))
	offset := (int(tt.Weekday()) + 6) % 7
	return tt.AddDate(0, 0, -offset)
}
