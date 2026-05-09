package usecases

import (
	"context"
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
)

func (u reminderUsecase) ListReminders(ctx context.Context, userID string, from, to time.Time) ([]model.ReminderCalendarDay, error) {
	return u.repo.ListReminders(ctx, userID, from, to)
}

func (u reminderUsecase) ListReminderDefinitions(ctx context.Context, userID string) ([]model.Reminder, error) {
	return u.repo.ListReminderDefinitions(ctx, userID)
}

func (u reminderUsecase) CreateReminder(ctx context.Context, userID string, req model.CreateReminderRequest) (model.Reminder, error) {
	return u.repo.CreateReminder(ctx, userID, req)
}

func (u reminderUsecase) PatchReminder(ctx context.Context, userID, reminderID string, req model.UpdateReminderRequest) (model.Reminder, error) {
	return u.repo.PatchReminder(ctx, userID, reminderID, req)
}

func (u reminderUsecase) DeleteReminder(ctx context.Context, userID, reminderID string) error {
	return u.repo.DeleteReminder(ctx, userID, reminderID)
}
