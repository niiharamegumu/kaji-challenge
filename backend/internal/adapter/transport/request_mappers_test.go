package transport

import (
	"testing"
	"time"

	"github.com/megu/kaji-challenge/backend/internal/application/model"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

func TestRequestMappersPreserveTransportValues(t *testing.T) {
	targetDate := time.Date(2026, time.August, 10, 0, 0, 0, 0, time.UTC)
	endDate := openapi_types.Date{Time: targetDate.AddDate(0, 0, 2)}
	schedule := api.ReminderScheduleType("weekly")
	request := api.CreateReminderRequest{
		EndDate:      &endDate,
		Kind:         api.ReminderKind("recurring"),
		Notes:        stringPtr("notes"),
		ScheduleType: &schedule,
		StartDate:    openapi_types.Date{Time: targetDate},
		Title:        "reminder",
	}

	got := createReminderRequestFromAPI(request)
	if got.Kind != model.Recurring || got.Title != request.Title || got.StartDate.Time != targetDate {
		t.Fatalf("unexpected reminder mapping: %#v", got)
	}
	if got.EndDate == nil || got.EndDate.Time != endDate.Time {
		t.Fatalf("end date mapping = %#v", got.EndDate)
	}
	if got.ScheduleType == nil || *got.ScheduleType != model.ReminderScheduleTypeWeekly {
		t.Fatalf("schedule type mapping = %#v", got.ScheduleType)
	}
}

func TestRequestMappersConvertNamedEnumsAndNestedFields(t *testing.T) {
	taskType := api.TaskType("weekly")
	if got := taskTypeFromAPI(&taskType); got == nil || *got != model.TaskTypeWeekly {
		t.Fatalf("task type mapping = %#v", got)
	}
	action := api.ToggleTaskCompletionRequestAction("increment")
	if got := completionActionFromAPI(&action); got == nil || *got != model.Increment {
		t.Fatalf("completion action mapping = %#v", got)
	}

	push := upsertPushSubscriptionRequestFromAPI(api.UpsertPushSubscriptionRequest{
		Endpoint: "https://push.example.test/subscription",
		Keys: api.PushSubscriptionKeys{
			Auth:   "auth-key",
			P256dh: "p256dh-key",
		},
		Platform: api.PushPlatform("ios_safari_pwa"),
	})
	if push.Keys.Auth != "auth-key" || push.Keys.P256dh != "p256dh-key" || push.Platform != model.PushPlatformIOSSafariWebApp {
		t.Fatalf("unexpected push mapping: %#v", push)
	}
}

func TestReorderRequestMappersDoNotAliasTransportSlices(t *testing.T) {
	taskIDs := []string{"task-1", "task-2"}
	itemIDs := []string{"item-1", "item-2"}
	tasks := reorderTasksRequestFromAPI(api.ReorderTasksRequest{TaskIds: taskIDs})
	items := reorderShoppingItemsRequestFromAPI(api.ReorderShoppingListItemsRequest{ItemIds: itemIDs})

	taskIDs[0] = "changed"
	itemIDs[0] = "changed"
	if tasks.TaskIds[0] != "task-1" || items.ItemIds[0] != "item-1" {
		t.Fatalf("mapped slices alias transport input: tasks=%v items=%v", tasks.TaskIds, items.ItemIds)
	}
}

func stringPtr(value string) *string {
	return &value
}
