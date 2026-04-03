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

	"github.com/jackc/pgx/v5"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
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
	fingerprint   string
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

func (s *Store) UpsertPushSubscription(ctx context.Context, userID string, req api.UpsertPushSubscriptionRequest) (api.PushSubscription, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.PushSubscription{}, err
	}
	endpoint := strings.TrimSpace(req.Endpoint)
	if endpoint == "" {
		return api.PushSubscription{}, errors.New("endpoint is required")
	}
	p256dh := strings.TrimSpace(req.Keys.P256dh)
	if p256dh == "" {
		return api.PushSubscription{}, errors.New("keys.p256dh is required")
	}
	auth := strings.TrimSpace(req.Keys.Auth)
	if auth == "" {
		return api.PushSubscription{}, errors.New("keys.auth is required")
	}
	platform := strings.TrimSpace(string(req.Platform))
	if platform != string(notifyPlatformIOSSafariPWA) {
		return api.PushSubscription{}, errors.New("invalid push platform")
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
		return api.PushSubscription{}, err
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

func (s *Store) ListPushSubscriptions(ctx context.Context, userID string) (api.ListPushSubscriptionsResponse, error) {
	rows, err := s.queries(ctx).ListPushSubscriptionsByUserID(ctx, userID)
	if err != nil {
		return api.ListPushSubscriptionsResponse{}, err
	}
	items := make([]api.PushSubscription, 0, len(rows))
	for _, row := range rows {
		items = append(items, pushSubscriptionFromListRowToAPI(row, s.loc))
	}
	return api.ListPushSubscriptionsResponse{
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
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return false, false, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if err := acquirePushDispatchLock(ctx, tx, teamID, slot, slotDate); err != nil {
		return false, false, err
	}

	qtx := s.q.WithTx(tx)
	txCtx := withTxQueries(ctx, qtx)
	dispatch, skip, err := s.preparePushDispatchAt(txCtx, teamID, slot, now, slotDate)
	if err != nil {
		return false, false, err
	}
	if skip {
		return false, true, nil
	}

	persisted, err := s.executePushDispatch(txCtx, dispatch, sender, now)
	if err != nil && !persisted {
		return false, false, err
	}
	if commitErr := tx.Commit(ctx); commitErr != nil {
		return false, false, commitErr
	}
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
	fingerprint := fingerprintForPendingTasks(slot, slotDate, tasks)
	state, err := s.queries(ctx).GetPushDispatchState(ctx, dbsqlc.GetPushDispatchStateParams{
		TeamID:   teamID,
		SlotKind: string(slot),
		SlotDate: toPgDate(slotDate),
	})
	if err == nil && state.Fingerprint == fingerprint {
		return preparedPushDispatch{}, true, nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return preparedPushDispatch{}, false, err
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
		teamID:      teamID,
		slotKind:    slot,
		slotDate:    slotDate,
		fingerprint: fingerprint,
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

func (s *Store) executePushDispatch(ctx context.Context, dispatch preparedPushDispatch, sender pushsvc.Sender, sentAt time.Time) (bool, error) {
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
				return false, deactivateErr
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
		return false, deliveryErr
	}
	if err := q.UpsertPushDispatchState(ctx, dbsqlc.UpsertPushDispatchStateParams{
		TeamID:      dispatch.teamID,
		SlotKind:    string(dispatch.slotKind),
		SlotDate:    toPgDate(dispatch.slotDate),
		Fingerprint: dispatch.fingerprint,
		SentAt:      toPgTimestamptz(sentAt),
		UpdatedAt:   toPgTimestamptz(sentAt),
	}); err != nil {
		return false, err
	}
	return true, deliveryErr
}

func logPushDispatchAttempt(dispatch preparedPushDispatch, endpoint string, result pushsvc.Result, err error) {
	u, parseErr := url.Parse(endpoint)
	host := ""
	if parseErr == nil {
		host = u.Host
	}
	endpointHash := sha256.Sum256([]byte(endpoint))
	hashText := hex.EncodeToString(endpointHash[:8])
	if err != nil {
		log.Printf(
			"push dispatch delivery result: team_id=%s slot=%s slot_date=%s host=%s endpoint_hash=%s status=%d expired=%t err=%v",
			dispatch.teamID,
			dispatch.slotKind,
			dispatch.slotDate.Format("2006-01-02"),
			host,
			hashText,
			result.StatusCode,
			result.Expired,
			err,
		)
		return
	}
	log.Printf(
		"push dispatch delivery result: team_id=%s slot=%s slot_date=%s host=%s endpoint_hash=%s status=%d expired=%t",
		dispatch.teamID,
		dispatch.slotKind,
		dispatch.slotDate.Format("2006-01-02"),
		host,
		hashText,
		result.StatusCode,
		result.Expired,
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
	case api.TaskTypeDaily:
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
	case api.TaskTypeWeekly:
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
		if slot.taskType() == api.TaskTypeWeekly && task.Remaining > 1 {
			label = fmt.Sprintf("%s（あと%d回）", task.Title, task.Remaining)
		}
		parts = append(parts, label)
	}
	if remaining := len(tasks) - previewLimit; remaining > 0 {
		parts = append(parts, fmt.Sprintf("ほか%d件", remaining))
	}
	return title, strings.Join(parts, "、")
}

func fingerprintForPendingTasks(slot notifySlot, slotDate time.Time, tasks []pendingPushTask) string {
	var b strings.Builder
	b.WriteString(string(slot))
	b.WriteString("|")
	b.WriteString(slotDate.Format("2006-01-02"))
	for _, task := range tasks {
		b.WriteString("|")
		b.WriteString(task.ID)
		b.WriteString(":")
		b.WriteString(task.Title)
		b.WriteString(":")
		b.WriteString(fmt.Sprintf("%d", task.Remaining))
	}
	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:])
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

func (s notifySlot) taskType() api.TaskType {
	switch s {
	case notifySlotDaily2100:
		return api.TaskTypeDaily
	default:
		return api.TaskTypeWeekly
	}
}

func pushSubscriptionFromUpsertRowToAPI(row dbsqlc.UpsertPushSubscriptionRow, loc *time.Location) api.PushSubscription {
	return api.PushSubscription{
		Id:         row.ID,
		TeamId:     row.TeamID,
		UserId:     row.UserID,
		Endpoint:   row.Endpoint,
		UserAgent:  stringPtrOrNil(row.UserAgent),
		Platform:   api.PushPlatform(row.Platform),
		IsActive:   row.IsActive,
		LastSeenAt: row.LastSeenAt.Time.In(loc),
		CreatedAt:  row.CreatedAt.Time.In(loc),
		UpdatedAt:  row.UpdatedAt.Time.In(loc),
	}
}

func pushSubscriptionFromListRowToAPI(row dbsqlc.ListPushSubscriptionsByUserIDRow, loc *time.Location) api.PushSubscription {
	return api.PushSubscription{
		Id:         row.ID,
		TeamId:     row.TeamID,
		UserId:     row.UserID,
		Endpoint:   row.Endpoint,
		UserAgent:  stringPtrOrNil(row.UserAgent),
		Platform:   api.PushPlatform(row.Platform),
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

var notifyPlatformIOSSafariPWA = string(api.IosSafariPwa)

func acquirePushDispatchLock(ctx context.Context, tx pgx.Tx, teamID string, slot notifySlot, slotDate time.Time) error {
	_, err := tx.Exec(
		ctx,
		"SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
		teamID,
		fmt.Sprintf("%s:%s", slot, slotDate.Format("2006-01-02")),
	)
	return err
}
