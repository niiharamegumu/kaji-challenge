package store

import (
	"context"
	"testing"
	"time"

	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func TestListRemindersIncludesPastDatesInCurrentMonth(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 15, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }
	teamID, userID := createTeamWithMember(t, s, "reminders-current-month@example.com", now)
	daily := api.ReminderScheduleTypeDaily

	createReminderAt(t, s, teamID, "daily", api.Recurring, &daily, now, dateMustParse("2026-04-01", s.loc), nil)
	createReminderAt(t, s, teamID, "one-time", api.OneTime, nil, now, dateMustParse("2026-04-10", s.loc), nil)

	days, err := s.ListReminders(ctx, userID, dateMustParse("2026-04-01", s.loc), dateMustParse("2026-04-30", s.loc))
	if err != nil {
		t.Fatalf("ListReminders failed: %v", err)
	}
	if !containsReminderOnDate(days, "2026-04-01", "daily") {
		t.Fatalf("expected current-month past recurring reminder on 2026-04-01: %#v", days)
	}
	if !containsReminderOnDate(days, "2026-04-10", "one-time") {
		t.Fatalf("expected current-month past one-time reminder on 2026-04-10: %#v", days)
	}
}

func TestListRemindersIncludesWeeklyOccurrenceOnCurrentMonthStart(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 5, 7, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }
	teamID, userID := createTeamWithMember(t, s, "reminders-weekly-month-start@example.com", now)
	weekly := api.ReminderScheduleTypeWeekly

	createReminderAt(t, s, teamID, "weekly", api.Recurring, &weekly, now, dateMustParse("2026-03-27", s.loc), nil)

	days, err := s.ListReminders(ctx, userID, dateMustParse("2026-05-01", s.loc), dateMustParse("2026-05-31", s.loc))
	if err != nil {
		t.Fatalf("ListReminders failed: %v", err)
	}
	if !containsReminderOnDate(days, "2026-05-01", "weekly") {
		t.Fatalf("expected current-month past weekly reminder on 2026-05-01: %#v", days)
	}
	if !containsReminderOnDate(days, "2026-05-08", "weekly") {
		t.Fatalf("expected weekly reminder on 2026-05-08: %#v", days)
	}
}

func TestListRemindersHidesPastMonth(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 15, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }
	teamID, userID := createTeamWithMember(t, s, "reminders-past-month@example.com", now)
	daily := api.ReminderScheduleTypeDaily

	createReminderAt(t, s, teamID, "march daily", api.Recurring, &daily, now, dateMustParse("2026-03-01", s.loc), nil)

	days, err := s.ListReminders(ctx, userID, dateMustParse("2026-03-01", s.loc), dateMustParse("2026-03-31", s.loc))
	if err != nil {
		t.Fatalf("ListReminders failed: %v", err)
	}
	if len(days) != 0 {
		t.Fatalf("expected past month to be hidden, got %#v", days)
	}
}

func TestGetTaskOverviewWeeklyRemindersStillStartsToday(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 15, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }
	teamID, userID := createTeamWithMember(t, s, "overview-reminders-current-week@example.com", now)

	createReminderAt(t, s, teamID, "yesterday", api.OneTime, nil, now, dateMustParse("2026-04-14", s.loc), nil)
	createReminderAt(t, s, teamID, "today", api.OneTime, nil, now, dateMustParse("2026-04-15", s.loc), nil)

	overview, err := s.GetTaskOverview(ctx, userID)
	if err != nil {
		t.Fatalf("GetTaskOverview failed: %v", err)
	}
	if containsOverviewReminder(overview.WeeklyReminders, "yesterday") {
		t.Fatalf("expected weekly reminders to exclude dates before today: %#v", overview.WeeklyReminders)
	}
	if !containsOverviewReminder(overview.WeeklyReminders, "today") {
		t.Fatalf("expected weekly reminders to include today: %#v", overview.WeeklyReminders)
	}
}

func containsReminderOnDate(days []api.ReminderCalendarDay, dateKey string, title string) bool {
	for _, day := range days {
		if day.Date.Time.Format("2006-01-02") != dateKey {
			continue
		}
		for _, item := range day.Items {
			if item.Title == title {
				return true
			}
		}
	}
	return false
}

func containsOverviewReminder(items []api.ReminderOccurrence, title string) bool {
	for _, item := range items {
		if item.Title == title {
			return true
		}
	}
	return false
}
