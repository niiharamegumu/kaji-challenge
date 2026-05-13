package usecases

import (
	"context"
	"errors"
	"testing"
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	"github.com/megu/kaji-challenge/backend/internal/application/ports"
	"github.com/megu/kaji-challenge/backend/internal/domain/notification"
)

type fakePushRepository struct {
	now           time.Time
	teamIDs       []string
	pendingTasks  map[string][]ports.PendingPushTask
	subscriptions map[string][]ports.PushSubscriptionTarget
	deactivated   []string
}

func (f *fakePushRepository) UpsertPushSubscription(context.Context, string, model.UpsertPushSubscriptionRequest) (model.PushSubscription, error) {
	return model.PushSubscription{}, nil
}

func (f *fakePushRepository) DeletePushSubscription(context.Context, string, string) error {
	return nil
}

func (f *fakePushRepository) ListPushSubscriptions(context.Context, string) (model.ListPushSubscriptionsResponse, error) {
	return model.ListPushSubscriptionsResponse{}, nil
}

func (f *fakePushRepository) ListPushTeamIDs(context.Context) ([]string, error) {
	return f.teamIDs, nil
}

func (f *fakePushRepository) ListPendingPushTasks(_ context.Context, teamID string, _ model.TaskType, _, _ time.Time) ([]ports.PendingPushTask, error) {
	return f.pendingTasks[teamID], nil
}

func (f *fakePushRepository) ListActivePushSubscriptions(_ context.Context, teamID string) ([]ports.PushSubscriptionTarget, error) {
	return f.subscriptions[teamID], nil
}

func (f *fakePushRepository) DeactivatePushSubscriptionByEndpoint(_ context.Context, endpoint string, _ time.Time) error {
	f.deactivated = append(f.deactivated, endpoint)
	return nil
}

func (f *fakePushRepository) Now() time.Time {
	return f.now
}

type fakePushSender struct {
	payloads []ports.PushPayload
	results  map[string]ports.PushResult
	errors   map[string]error
}

func (f *fakePushSender) Send(_ context.Context, endpoint ports.PushSubscriptionEndpoint, payload ports.PushPayload) (ports.PushResult, error) {
	f.payloads = append(f.payloads, payload)
	return f.results[endpoint.Endpoint], f.errors[endpoint.Endpoint]
}

func TestBuildPushMessageForWeeklyTasksIncludesRemainingCount(t *testing.T) {
	title, body := buildPushMessage(notification.SlotWeeklyPrevSat1900, []ports.PendingPushTask{
		{ID: "task-1", Title: "風呂掃除", Remaining: 2},
		{ID: "task-2", Title: "洗濯槽掃除", Remaining: 1},
	})

	if title != "今週の未完了が2件あります" {
		t.Fatalf("unexpected title: %s", title)
	}
	if body != "週間タスク\n風呂掃除（あと2回）、洗濯槽掃除" {
		t.Fatalf("unexpected body: %s", body)
	}
}

func TestBuildPushMessageForDailyTasksIncludesTaskTypeLabel(t *testing.T) {
	title, body := buildPushMessage(notification.SlotDaily2100, []ports.PendingPushTask{
		{ID: "task-1", Title: "皿洗い", Remaining: 1},
		{ID: "task-2", Title: "洗濯", Remaining: 1},
		{ID: "task-3", Title: "ゴミ出し", Remaining: 1},
		{ID: "task-4", Title: "床掃除", Remaining: 1},
	})

	if title != "今日の未完了が4件あります" {
		t.Fatalf("unexpected title: %s", title)
	}
	if body != "日間タスク\n皿洗い、洗濯、ゴミ出し、ほか1件" {
		t.Fatalf("unexpected body: %s", body)
	}
}

func TestNotifySlotDispatchesPendingTasksAndSkipsEmptyTeams(t *testing.T) {
	repo := &fakePushRepository{
		now:     time.Date(2026, 4, 2, 21, 0, 0, 0, time.FixedZone("JST", 9*60*60)),
		teamIDs: []string{"team-a", "team-b"},
		pendingTasks: map[string][]ports.PendingPushTask{
			"team-a": {{ID: "task-1", Title: "皿洗い", Remaining: 1}},
		},
		subscriptions: map[string][]ports.PushSubscriptionTarget{
			"team-a": {{Endpoint: "https://push.example.test/a"}},
		},
	}
	sender := &fakePushSender{results: map[string]ports.PushResult{}, errors: map[string]error{}}
	uc := pushUsecase{repo: repo}

	result, err := uc.NotifySlot(context.Background(), string(notification.SlotDaily2100), sender)
	if err != nil {
		t.Fatalf("NotifySlot failed: %v", err)
	}
	if result.Processed != 2 || result.Sent != 1 || result.Skipped != 1 || result.Failed != 0 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if len(sender.payloads) != 1 {
		t.Fatalf("expected one payload, got %d", len(sender.payloads))
	}
	payload := sender.payloads[0]
	if payload.TeamID != "team-a" || payload.SlotKind != string(notification.SlotDaily2100) {
		t.Fatalf("unexpected payload routing: %+v", payload)
	}
	if payload.Title != "今日の未完了が1件あります" || payload.Tag != "team:team-a:daily_2100:2026-04-02" {
		t.Fatalf("unexpected payload content: %+v", payload)
	}
}

func TestNotifySlotDeactivatesExpiredSubscriptionWithoutFailingTeam(t *testing.T) {
	repo := &fakePushRepository{
		now:     time.Date(2026, 4, 2, 21, 0, 0, 0, time.FixedZone("JST", 9*60*60)),
		teamIDs: []string{"team-a"},
		pendingTasks: map[string][]ports.PendingPushTask{
			"team-a": {{ID: "task-1", Title: "皿洗い", Remaining: 1}},
		},
		subscriptions: map[string][]ports.PushSubscriptionTarget{
			"team-a": {{Endpoint: "https://push.example.test/expired"}},
		},
	}
	sender := &fakePushSender{
		results: map[string]ports.PushResult{"https://push.example.test/expired": {Expired: true}},
		errors:  map[string]error{},
	}
	uc := pushUsecase{repo: repo}

	result, err := uc.NotifySlot(context.Background(), string(notification.SlotDaily2100), sender)
	if err != nil {
		t.Fatalf("NotifySlot failed: %v", err)
	}
	if result.Processed != 1 || result.Sent != 1 || result.Failed != 0 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if len(repo.deactivated) != 1 || repo.deactivated[0] != "https://push.example.test/expired" {
		t.Fatalf("expected expired endpoint deactivation, got %v", repo.deactivated)
	}
}

func TestNotifySlotReportsDeliveryFailureWhenAllDeliveriesFail(t *testing.T) {
	repo := &fakePushRepository{
		now:     time.Date(2026, 4, 2, 21, 0, 0, 0, time.FixedZone("JST", 9*60*60)),
		teamIDs: []string{"team-a"},
		pendingTasks: map[string][]ports.PendingPushTask{
			"team-a": {{ID: "task-1", Title: "皿洗い", Remaining: 1}},
		},
		subscriptions: map[string][]ports.PushSubscriptionTarget{
			"team-a": {{Endpoint: "https://push.example.test/fail"}},
		},
	}
	sender := &fakePushSender{
		results: map[string]ports.PushResult{},
		errors:  map[string]error{"https://push.example.test/fail": errors.New("delivery failed")},
	}
	uc := pushUsecase{repo: repo}

	result, err := uc.NotifySlot(context.Background(), string(notification.SlotDaily2100), sender)
	if err == nil {
		t.Fatalf("expected NotifySlot error")
	}
	if result.Processed != 1 || result.Sent != 0 || result.Failed != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
}
