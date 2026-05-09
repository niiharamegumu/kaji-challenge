package usecases

import (
	"testing"

	"github.com/megu/kaji-challenge/backend/internal/application/ports"
	"github.com/megu/kaji-challenge/backend/internal/domain/notification"
)

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
