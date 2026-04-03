package store

import (
	"context"
	"errors"
	"testing"
	"time"

	pushsvc "github.com/megu/kaji-challenge/backend/internal/push"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

type fakePushSender struct {
	sendCount int
	payloads  []pushsvc.Payload
	results   map[string]pushsvc.Result
	errors    map[string]error
}

func (f *fakePushSender) Send(_ context.Context, sub pushsvc.Subscription, payload pushsvc.Payload) (pushsvc.Result, error) {
	f.sendCount++
	f.payloads = append(f.payloads, payload)
	return f.results[sub.Endpoint], f.errors[sub.Endpoint]
}

func (f *fakePushSender) PublicKey() string {
	return "BElfakeKey"
}

func TestPushSubscriptionLifecycle(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	t.Setenv("VAPID_PUBLIC_KEY", "BElfakeKey")
	_, userID := createTeamWithMember(t, s, "push-lifecycle@example.com", time.Date(2026, 4, 1, 9, 0, 0, 0, s.loc))

	first, err := s.UpsertPushSubscription(ctx, userID, api.UpsertPushSubscriptionRequest{
		Endpoint: "https://example.com/push/1",
		Keys: api.PushSubscriptionKeys{
			P256dh: "key-1",
			Auth:   "auth-1",
		},
		Platform: api.PushPlatform(notifyPlatformIOSSafariPWA),
	})
	if err != nil {
		t.Fatalf("first UpsertPushSubscription failed: %v", err)
	}

	second, err := s.UpsertPushSubscription(ctx, userID, api.UpsertPushSubscriptionRequest{
		Endpoint: "https://example.com/push/1",
		Keys: api.PushSubscriptionKeys{
			P256dh: "key-2",
			Auth:   "auth-2",
		},
		Platform:  api.PushPlatform(notifyPlatformIOSSafariPWA),
		UserAgent: stringPtrForPushTest("MobileSafari"),
	})
	if err != nil {
		t.Fatalf("second UpsertPushSubscription failed: %v", err)
	}
	if first.Id != second.Id {
		t.Fatalf("expected upsert to reuse subscription id, got %s and %s", first.Id, second.Id)
	}

	list, err := s.ListPushSubscriptions(ctx, userID)
	if err != nil {
		t.Fatalf("ListPushSubscriptions failed: %v", err)
	}
	if list.VapidPublicKey != "BElfakeKey" {
		t.Fatalf("unexpected vapid public key: %q", list.VapidPublicKey)
	}
	if len(list.Items) != 1 || list.Items[0].UserAgent == nil || *list.Items[0].UserAgent != "MobileSafari" {
		t.Fatalf("unexpected subscription list: %#v", list.Items)
	}

	if err := s.DeletePushSubscription(ctx, userID, second.Id); err != nil {
		t.Fatalf("DeletePushSubscription failed: %v", err)
	}

	list, err = s.ListPushSubscriptions(ctx, userID)
	if err != nil {
		t.Fatalf("ListPushSubscriptions after delete failed: %v", err)
	}
	if len(list.Items) != 1 || list.Items[0].IsActive {
		t.Fatalf("expected inactive subscription after delete, got %#v", list.Items)
	}
}

func TestNotifySlotSkipsWhenFingerprintUnchanged(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 3, 21, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }

	teamID, userID := createTeamWithMember(t, s, "push-notify@example.com", now.Add(-24*time.Hour))
	createTaskWithIDAt(t, s, teamID, api.TaskTypeDaily, 3, 1, now.Add(-24*time.Hour))
	_, err := s.UpsertPushSubscription(ctx, userID, api.UpsertPushSubscriptionRequest{
		Endpoint: "https://example.com/push/notify",
		Keys: api.PushSubscriptionKeys{
			P256dh: "key-notify",
			Auth:   "auth-notify",
		},
		Platform: api.PushPlatform(notifyPlatformIOSSafariPWA),
	})
	if err != nil {
		t.Fatalf("UpsertPushSubscription failed: %v", err)
	}

	sender := &fakePushSender{
		results: map[string]pushsvc.Result{
			"https://example.com/push/notify": {StatusCode: 201},
		},
		errors: map[string]error{},
	}

	first, err := s.NotifySlot(ctx, string(notifySlotDaily2100), sender)
	if err != nil {
		t.Fatalf("first NotifySlot failed: %v", err)
	}
	if first.Sent != 1 || sender.sendCount != 1 {
		t.Fatalf("expected first notify to send once, result=%+v sendCount=%d", first, sender.sendCount)
	}

	second, err := s.NotifySlot(ctx, string(notifySlotDaily2100), sender)
	if err != nil {
		t.Fatalf("second NotifySlot failed: %v", err)
	}
	if second.Skipped != 1 || sender.sendCount != 1 {
		t.Fatalf("expected duplicate notify to be skipped, result=%+v sendCount=%d", second, sender.sendCount)
	}
}

func TestNotifySlotDeactivatesExpiredEndpoint(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 5, 10, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }

	teamID, userID := createTeamWithMember(t, s, "push-expired@example.com", now.Add(-7*24*time.Hour))
	createTaskWithIDAt(t, s, teamID, api.TaskTypeWeekly, 5, 2, now.Add(-7*24*time.Hour))
	sub, err := s.UpsertPushSubscription(ctx, userID, api.UpsertPushSubscriptionRequest{
		Endpoint: "https://example.com/push/expired",
		Keys: api.PushSubscriptionKeys{
			P256dh: "key-expired",
			Auth:   "auth-expired",
		},
		Platform: api.PushPlatform(notifyPlatformIOSSafariPWA),
	})
	if err != nil {
		t.Fatalf("UpsertPushSubscription failed: %v", err)
	}

	sender := &fakePushSender{
		results: map[string]pushsvc.Result{
			"https://example.com/push/expired": {
				StatusCode: 410,
				Expired:    true,
			},
		},
		errors: map[string]error{},
	}

	if _, err := s.NotifySlot(ctx, string(notifySlotWeeklyDueSun1000), sender); err != nil {
		t.Fatalf("NotifySlot failed: %v", err)
	}

	list, err := s.ListPushSubscriptions(ctx, userID)
	if err != nil {
		t.Fatalf("ListPushSubscriptions failed: %v", err)
	}
	if len(list.Items) != 1 || list.Items[0].Id != sub.Id || list.Items[0].IsActive {
		t.Fatalf("expected expired endpoint to be deactivated, got %#v", list.Items)
	}
}

func TestNotifySlotSkipsResendAfterPartialDeliveryFailure(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 3, 21, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }

	teamID, userID := createTeamWithMember(t, s, "push-partial@example.com", now.Add(-24*time.Hour))
	createTaskWithIDAt(t, s, teamID, api.TaskTypeDaily, 3, 1, now.Add(-24*time.Hour))

	for _, endpoint := range []string{
		"https://example.com/push/success",
		"https://example.com/push/fail",
	} {
		_, err := s.UpsertPushSubscription(ctx, userID, api.UpsertPushSubscriptionRequest{
			Endpoint: endpoint,
			Keys: api.PushSubscriptionKeys{
				P256dh: "key-" + endpoint,
				Auth:   "auth-" + endpoint,
			},
			Platform: api.PushPlatform(notifyPlatformIOSSafariPWA),
		})
		if err != nil {
			t.Fatalf("UpsertPushSubscription failed: %v", err)
		}
	}

	sender := &fakePushSender{
		results: map[string]pushsvc.Result{
			"https://example.com/push/success": {StatusCode: 201},
		},
		errors: map[string]error{
			"https://example.com/push/fail": errors.New("temporary push error"),
		},
	}

	first, err := s.NotifySlot(ctx, string(notifySlotDaily2100), sender)
	if err == nil {
		t.Fatalf("expected first NotifySlot to report partial failure")
	}
	if first.Failed != 1 || sender.sendCount != 2 {
		t.Fatalf("unexpected first notify result=%+v sendCount=%d", first, sender.sendCount)
	}

	second, err := s.NotifySlot(ctx, string(notifySlotDaily2100), sender)
	if err != nil {
		t.Fatalf("second NotifySlot failed: %v", err)
	}
	if second.Skipped != 1 || sender.sendCount != 2 {
		t.Fatalf("expected second notify to be skipped, result=%+v sendCount=%d", second, sender.sendCount)
	}
}

func TestBuildPushMessageForWeeklyTasksIncludesRemainingCount(t *testing.T) {
	title, body := buildPushMessage(notifySlotWeeklyPrevSat1900, []pendingPushTask{
		{ID: "task-1", Title: "風呂掃除", Remaining: 2},
		{ID: "task-2", Title: "洗濯槽掃除", Remaining: 1},
	})

	if title != "今週の未完了が2件あります" {
		t.Fatalf("unexpected title: %s", title)
	}
	if body != "風呂掃除（あと2回）、洗濯槽掃除" {
		t.Fatalf("unexpected body: %s", body)
	}
}

func stringPtrForPushTest(value string) *string {
	return &value
}
