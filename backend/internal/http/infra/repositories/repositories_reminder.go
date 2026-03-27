package repositories

import (
	"context"
	"time"

	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (r reminderRepo) ListReminders(ctx context.Context, userID string, from, to time.Time) ([]api.ReminderCalendarDay, error) {
	items, err := r.store.ListReminders(ctx, userID, from, to)
	return items, mapInfraErr(err)
}

func (r reminderRepo) ListReminderDefinitions(ctx context.Context, userID string) ([]api.Reminder, error) {
	items, err := r.store.ListReminderDefinitions(ctx, userID)
	return items, mapInfraErr(err)
}

func (r reminderRepo) CreateReminder(ctx context.Context, userID string, req api.CreateReminderRequest) (api.Reminder, error) {
	item, err := r.store.CreateReminder(ctx, userID, req)
	return item, mapInfraErr(err)
}

func (r reminderRepo) PatchReminder(ctx context.Context, userID, reminderID string, req api.UpdateReminderRequest) (api.Reminder, error) {
	item, err := r.store.PatchReminder(ctx, userID, reminderID, req)
	return item, mapInfraErr(err)
}

func (r reminderRepo) DeleteReminder(ctx context.Context, userID, reminderID string) error {
	return mapInfraErr(r.store.DeleteReminder(ctx, userID, reminderID))
}
