package reminder

import (
	"testing"
	"time"
)

func TestValidate(t *testing.T) {
	start := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	schedule := ScheduleWeekly
	if err := Validate(Reminder{Title: "燃えるごみ", Kind: KindRecurring, ScheduleType: &schedule, StartDate: start}); err != nil {
		t.Fatalf("valid recurring reminder failed: %v", err)
	}
	if err := Validate(Reminder{Title: "燃えるごみ", Kind: KindOneTime, ScheduleType: &schedule, StartDate: start}); err == nil {
		t.Fatal("expected one-time reminder with schedule type to fail")
	}
	end := start.AddDate(0, 0, -1)
	if err := Validate(Reminder{Title: "燃えるごみ", Kind: KindRecurring, ScheduleType: &schedule, StartDate: start, EndDate: &end}); err == nil {
		t.Fatal("expected end date before start to fail")
	}
}

func TestExpandOccurrences(t *testing.T) {
	start := time.Date(2026, 1, 31, 0, 0, 0, 0, time.UTC)
	monthly := ScheduleMonthly
	record := Reminder{ID: "rem_1", Title: "月末", Kind: KindRecurring, ScheduleType: &monthly, StartDate: start}

	got := ExpandOccurrences(record, time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 4, 30, 0, 0, 0, 0, time.UTC))
	if len(got) != 1 {
		t.Fatalf("expected 1 monthly occurrence, got %#v", got)
	}
	if got[0].Date.Format("2006-01-02") != "2026-03-31" {
		t.Fatalf("unexpected monthly occurrences: %#v", got)
	}
}

func TestNextWeeklyOccurrence(t *testing.T) {
	from := time.Date(2026, 3, 10, 0, 0, 0, 0, time.UTC)
	start := time.Date(2026, 3, 8, 0, 0, 0, 0, time.UTC)
	got := NextWeeklyOccurrence(from, start)
	if got.Format("2006-01-02") != "2026-03-15" {
		t.Fatalf("NextWeeklyOccurrence() = %s, want 2026-03-15", got.Format("2006-01-02"))
	}
}
