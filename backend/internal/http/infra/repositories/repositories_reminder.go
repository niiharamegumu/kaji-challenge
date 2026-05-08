package repositories

import (
	"context"
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/http/application/model"
)

func (r reminderRepo) ListReminders(ctx context.Context, userID string, from, to time.Time) ([]model.ReminderCalendarDay, error) {
	items, err := r.store.ListReminders(ctx, userID, from, to)
	return items, mapInfraErr(err)
}

func (r reminderRepo) ListReminderDefinitions(ctx context.Context, userID string) ([]model.Reminder, error) {
	items, err := r.store.ListReminderDefinitions(ctx, userID)
	return items, mapInfraErr(err)
}

func (r reminderRepo) CreateReminder(ctx context.Context, userID string, req model.CreateReminderRequest) (model.Reminder, error) {
	item, err := r.store.CreateReminder(ctx, userID, req)
	return item, mapInfraErr(err)
}

func (r reminderRepo) PatchReminder(ctx context.Context, userID, reminderID string, req model.UpdateReminderRequest) (model.Reminder, error) {
	item, err := r.store.PatchReminder(ctx, userID, reminderID, req)
	return item, mapInfraErr(err)
}

func (r reminderRepo) DeleteReminder(ctx context.Context, userID, reminderID string) error {
	return mapInfraErr(r.store.DeleteReminder(ctx, userID, reminderID))
}
