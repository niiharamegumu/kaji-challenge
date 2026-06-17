package store

import (
	"context"
	"testing"
	"time"

	"github.com/megu/kaji-challenge/backend/internal/adapter/persistence/postgres/repositories"
	model "github.com/megu/kaji-challenge/backend/internal/application/model"
)

func TestListRemindersIncludesPastDatesInCurrentMonth(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 15, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }
	teamID, userID := createTeamWithMember(t, s, "reminders-current-month@example.com", now)
	daily := model.ReminderScheduleTypeDaily

	createReminderAt(t, s, teamID, "daily", model.Recurring, &daily, now, dateMustParse("2026-04-01", s.loc), nil)
	createReminderAt(t, s, teamID, "one-time", model.OneTime, nil, now, dateMustParse("2026-04-10", s.loc), nil)

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
	weekly := model.ReminderScheduleTypeWeekly

	createReminderAt(t, s, teamID, "weekly", model.Recurring, &weekly, now, dateMustParse("2026-03-27", s.loc), nil)

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
	daily := model.ReminderScheduleTypeDaily

	createReminderAt(t, s, teamID, "march daily", model.Recurring, &daily, now, dateMustParse("2026-03-01", s.loc), nil)

	days, err := s.ListReminders(ctx, userID, dateMustParse("2026-03-01", s.loc), dateMustParse("2026-03-31", s.loc))
	if err != nil {
		t.Fatalf("ListReminders failed: %v", err)
	}
	if len(days) != 0 {
		t.Fatalf("expected past month to be hidden, got %#v", days)
	}
}

func TestReminderDefinitionLifecycleCleansExpiredOneTime(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 15, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }
	teamID, userID := createTeamWithMember(t, s, "reminder-lifecycle@example.com", now)
	daily := model.ReminderScheduleTypeDaily
	notes := "bring card"

	createReminderAt(t, s, teamID, "expired one-time", model.OneTime, nil, now.Add(-48*time.Hour), dateMustParse("2026-03-30", s.loc), nil)
	created, err := s.CreateReminder(withLatestIfMatchForUser(t, s, ctx, userID), userID, model.CreateReminderRequest{
		Title:        "  Daily reminder  ",
		Notes:        &notes,
		Kind:         model.Recurring,
		ScheduleType: &daily,
		StartDate:    model.Date{Time: dateMustParse("2026-04-15", s.loc)},
	})
	if err != nil {
		t.Fatalf("CreateReminder failed: %v", err)
	}
	if created.Title != "Daily reminder" || created.Notes == nil || *created.Notes != notes {
		t.Fatalf("unexpected created reminder: %+v", created)
	}

	definitions, err := s.ListReminderDefinitions(ctx, userID)
	if err != nil {
		t.Fatalf("ListReminderDefinitions failed: %v", err)
	}
	if len(definitions) != 1 || definitions[0].Title != "Daily reminder" {
		t.Fatalf("expected expired one-time reminder to be cleaned up, got %+v", definitions)
	}

	title := "Weekly reminder"
	weekly := model.ReminderScheduleTypeWeekly
	patched, err := s.PatchReminder(withLatestIfMatchForUser(t, s, ctx, userID), userID, created.Id, model.UpdateReminderRequest{
		Title:        &title,
		ScheduleType: &weekly,
	})
	if err != nil {
		t.Fatalf("PatchReminder failed: %v", err)
	}
	if patched.Title != title || patched.ScheduleType == nil || *patched.ScheduleType != weekly {
		t.Fatalf("unexpected patched reminder: %+v", patched)
	}

	if err := s.DeleteReminder(withLatestIfMatchForUser(t, s, ctx, userID), userID, created.Id); err != nil {
		t.Fatalf("DeleteReminder failed: %v", err)
	}
	definitions, err = s.ListReminderDefinitions(ctx, userID)
	if err != nil {
		t.Fatalf("ListReminderDefinitions after delete failed: %v", err)
	}
	if len(definitions) != 0 {
		t.Fatalf("expected no reminder definitions after delete, got %+v", definitions)
	}
}

func TestReminderMutationsRejectMissingIfMatchAndInvalidRange(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 15, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }
	_, userID := createTeamWithMember(t, s, "reminder-errors@example.com", now)
	daily := model.ReminderScheduleTypeDaily

	if _, err := s.CreateReminder(ctx, userID, model.CreateReminderRequest{
		Title:        "daily",
		Kind:         model.Recurring,
		ScheduleType: &daily,
		StartDate:    model.Date{Time: now},
	}); err == nil {
		t.Fatal("expected missing If-Match to fail")
	}

	if _, err := s.ListReminders(ctx, userID, dateMustParse("2026-04-20", s.loc), dateMustParse("2026-04-10", s.loc)); err == nil {
		t.Fatal("expected invalid date range to fail")
	}
}

func TestGetTaskOverviewWeeklyRemindersStillStartsToday(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 15, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }
	teamID, userID := createTeamWithMember(t, s, "overview-reminders-current-week@example.com", now)

	createReminderAt(t, s, teamID, "yesterday", model.OneTime, nil, now, dateMustParse("2026-04-14", s.loc), nil)
	createReminderAt(t, s, teamID, "today", model.OneTime, nil, now, dateMustParse("2026-04-15", s.loc), nil)

	overview, err := repositories.NewServices(s).TaskOverview.GetTaskOverview(ctx, userID)
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

func containsReminderOnDate(days []model.ReminderCalendarDay, dateKey string, title string) bool {
	for _, day := range days {
		if day.Date.Format("2006-01-02") != dateKey {
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

func containsOverviewReminder(items []model.ReminderOccurrence, title string) bool {
	for _, item := range items {
		if item.Title == title {
			return true
		}
	}
	return false
}
