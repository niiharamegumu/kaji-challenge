package usecases

import (
	"context"
	"testing"
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	"github.com/megu/kaji-challenge/backend/internal/application/ports"
)

type fakeTaskOverviewRepo struct {
	now     time.Time
	teamID  string
	summary ports.MonthlyPenaltySummarySnapshot

	tasks              []ports.OverviewTask
	dailyActors        []ports.DailyCompletionActor
	weeklyCounts       []ports.WeeklyCompletionCount
	weeklySlots        []ports.WeeklyCompletionSlot
	reminders          []ports.ReminderRecord
	triggeredRuleIDs   []string
	effectiveRules     []ports.PenaltyRuleSnapshot
	monthlyTasks       []ports.MonthlyTaskStatusRecord
	dailyByMonth       []ports.DailyCompletionByDate
	weeklyByMonth      []ports.WeeklyCompletionCountByWeek
	weeklySlotsByMonth []ports.WeeklyCompletionSlotByWeek

	cleanupCalled bool
}

func (f *fakeTaskOverviewRepo) PrimaryTeamID(context.Context, string) (string, error) {
	return f.teamID, nil
}
func (f *fakeTaskOverviewRepo) Now() time.Time { return f.now }
func (f *fakeTaskOverviewRepo) EnsureMonthSummary(context.Context, string, string) (ports.MonthlyPenaltySummarySnapshot, error) {
	return f.summary, nil
}
func (f *fakeTaskOverviewRepo) CleanupExpiredOneTimeReminders(context.Context, string) error {
	f.cleanupCalled = true
	return nil
}
func (f *fakeTaskOverviewRepo) ListOverviewTasks(context.Context, string) ([]ports.OverviewTask, error) {
	return f.tasks, nil
}
func (f *fakeTaskOverviewRepo) ListDailyCompletionActors(context.Context, string, time.Time) ([]ports.DailyCompletionActor, error) {
	return f.dailyActors, nil
}
func (f *fakeTaskOverviewRepo) ListWeeklyCompletionCounts(context.Context, string, time.Time) ([]ports.WeeklyCompletionCount, error) {
	return f.weeklyCounts, nil
}
func (f *fakeTaskOverviewRepo) ListWeeklyCompletionSlots(context.Context, string, time.Time) ([]ports.WeeklyCompletionSlot, error) {
	return f.weeklySlots, nil
}
func (f *fakeTaskOverviewRepo) ListReminderRecords(context.Context, string) ([]ports.ReminderRecord, error) {
	return f.reminders, nil
}
func (f *fakeTaskOverviewRepo) ListTriggeredRuleIDs(context.Context, string, time.Time) ([]string, error) {
	return f.triggeredRuleIDs, nil
}
func (f *fakeTaskOverviewRepo) ListEffectivePenaltyRules(context.Context, string, time.Time) ([]ports.PenaltyRuleSnapshot, error) {
	return f.effectiveRules, nil
}
func (f *fakeTaskOverviewRepo) ListMonthlyStatusTasks(context.Context, string, time.Time, time.Time) ([]ports.MonthlyTaskStatusRecord, error) {
	return f.monthlyTasks, nil
}
func (f *fakeTaskOverviewRepo) ListDailyCompletionsByMonth(context.Context, string, time.Time, time.Time) ([]ports.DailyCompletionByDate, error) {
	return f.dailyByMonth, nil
}
func (f *fakeTaskOverviewRepo) ListWeeklyCompletionCountsByMonth(context.Context, string, time.Time, time.Time) ([]ports.WeeklyCompletionCountByWeek, error) {
	return f.weeklyByMonth, nil
}
func (f *fakeTaskOverviewRepo) ListWeeklyCompletionSlotsByMonth(context.Context, string, time.Time, time.Time) ([]ports.WeeklyCompletionSlotByWeek, error) {
	return f.weeklySlotsByMonth, nil
}

func TestTaskOverviewBuildsTasksSlotsActorsAndReminderOccurrences(t *testing.T) {
	loc := time.FixedZone("JST", 9*60*60)
	now := time.Date(2026, 5, 13, 9, 0, 0, 0, loc)
	color := "#AABBCC"
	weekly := model.ReminderScheduleTypeWeekly
	repo := &fakeTaskOverviewRepo{
		now:    now,
		teamID: "team-1",
		summary: ports.MonthlyPenaltySummarySnapshot{
			TeamID:             "team-1",
			MonthStart:         time.Date(2026, 5, 1, 0, 0, 0, 0, loc),
			DailyPenaltyTotal:  2,
			WeeklyPenaltyTotal: 3,
		},
		tasks: []ports.OverviewTask{
			{ID: "daily-2", TeamID: "team-1", Title: "B", Type: model.TaskTypeDaily, PenaltyPoints: 1, SortKey: 20, CreatedAt: now.Add(-2 * time.Hour), UpdatedAt: now},
			{ID: "daily-1", TeamID: "team-1", Title: "A", Type: model.TaskTypeDaily, PenaltyPoints: 1, SortKey: 10, CreatedAt: now.Add(-time.Hour), UpdatedAt: now},
			{ID: "weekly-1", TeamID: "team-1", Title: "W", Type: model.TaskTypeWeekly, PenaltyPoints: 4, RequiredCompletionsPerWeek: 3, SortKey: 1, CreatedAt: now.Add(-24 * time.Hour), UpdatedAt: now},
		},
		dailyActors:  []ports.DailyCompletionActor{{TaskID: "daily-1", Actor: &ports.TaskCompletionActor{UserID: "user-1", EffectiveName: "Alice", ColorHex: &color}}},
		weeklyCounts: []ports.WeeklyCompletionCount{{TaskID: "weekly-1", CompletionCount: 2}},
		weeklySlots: []ports.WeeklyCompletionSlot{
			{TaskID: "weekly-1", Slot: 2, Actor: &ports.TaskCompletionActor{UserID: "user-1", EffectiveName: "Alice", ColorHex: &color}},
		},
		reminders: []ports.ReminderRecord{{
			ID: "rem-1", TeamID: "team-1", Title: "Weekly reminder", Kind: model.Recurring, ScheduleType: &weekly,
			StartDate: time.Date(2026, 5, 6, 0, 0, 0, 0, loc), CreatedAt: now.Add(-3 * time.Hour), UpdatedAt: now,
		}},
	}
	uc := taskOverviewUsecase{repo: repo}

	got, err := uc.GetTaskOverview(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("GetTaskOverview failed: %v", err)
	}
	if !repo.cleanupCalled {
		t.Fatal("expected reminder cleanup")
	}
	if got.Month != "2026-05" || got.MonthlyPenaltyTotal != 5 || got.ElapsedDaysInWeek != 3 {
		t.Fatalf("unexpected overview summary: %+v", got)
	}
	if len(got.DailyTasks) != 2 || got.DailyTasks[0].Task.Id != "daily-1" || !got.DailyTasks[0].CompletedToday {
		t.Fatalf("unexpected daily tasks: %+v", got.DailyTasks)
	}
	if got.DailyTasks[0].CompletedBy == nil || got.DailyTasks[0].CompletedBy.EffectiveName != "Alice" {
		t.Fatalf("unexpected daily actor: %+v", got.DailyTasks[0].CompletedBy)
	}
	if len(got.WeeklyTasks) != 1 || got.WeeklyTasks[0].WeekCompletedCount != 2 || len(got.WeeklyTasks[0].CompletionSlots) != 3 {
		t.Fatalf("unexpected weekly tasks: %+v", got.WeeklyTasks)
	}
	if got.WeeklyTasks[0].CompletionSlots[1].Actor == nil || got.WeeklyTasks[0].CompletionSlots[1].Actor.UserId != "user-1" {
		t.Fatalf("expected actor in weekly slot 2: %+v", got.WeeklyTasks[0].CompletionSlots)
	}
	if len(got.WeeklyReminders) != 1 || got.WeeklyReminders[0].Date.Time.Format(time.DateOnly) != "2026-05-13" {
		t.Fatalf("unexpected reminder occurrences: %+v", got.WeeklyReminders)
	}
}

func TestMonthlySummaryBuildsStatusByDateAndCompletionSlots(t *testing.T) {
	loc := time.FixedZone("JST", 9*60*60)
	now := time.Date(2026, 5, 13, 9, 0, 0, 0, loc)
	color := "#AABBCC"
	deleted := time.Date(2026, 5, 20, 0, 0, 0, 0, loc)
	repo := &fakeTaskOverviewRepo{
		now:    now,
		teamID: "team-1",
		summary: ports.MonthlyPenaltySummarySnapshot{
			TeamID:             "team-1",
			MonthStart:         time.Date(2026, 5, 1, 0, 0, 0, 0, loc),
			DailyPenaltyTotal:  4,
			WeeklyPenaltyTotal: 3,
		},
		effectiveRules: []ports.PenaltyRuleSnapshot{{ID: "rule-5", Threshold: 5}, {ID: "rule-9", Threshold: 9}},
		monthlyTasks: []ports.MonthlyTaskStatusRecord{
			{ID: "daily-1", TeamID: "team-1", Title: "Daily", Type: model.TaskTypeDaily, PenaltyPoints: 1, SortKey: 1, CreatedAt: time.Date(2026, 5, 1, 0, 0, 0, 0, loc), UpdatedAt: now},
			{ID: "weekly-1", TeamID: "team-1", Title: "Weekly", Type: model.TaskTypeWeekly, PenaltyPoints: 2, RequiredCompletionsPerWeek: 2, SortKey: 2, CreatedAt: time.Date(2026, 4, 20, 0, 0, 0, 0, loc), UpdatedAt: now, DeletedAt: &deleted},
		},
		dailyByMonth:       []ports.DailyCompletionByDate{{Date: time.Date(2026, 5, 13, 0, 0, 0, 0, loc), TaskID: "daily-1", Actor: &ports.TaskCompletionActor{UserID: "user-1", EffectiveName: "Alice", ColorHex: &color}}},
		weeklyByMonth:      []ports.WeeklyCompletionCountByWeek{{WeekStart: time.Date(2026, 5, 11, 0, 0, 0, 0, loc), TaskID: "weekly-1", CompletionCount: 2}},
		weeklySlotsByMonth: []ports.WeeklyCompletionSlotByWeek{{WeekStart: time.Date(2026, 5, 11, 0, 0, 0, 0, loc), TaskID: "weekly-1", Slot: 1, Actor: &ports.TaskCompletionActor{UserID: "user-1", EffectiveName: "Alice", ColorHex: &color}}},
	}
	uc := taskOverviewUsecase{repo: repo}
	month := "2026-05"

	got, err := uc.GetMonthlySummary(context.Background(), "user-1", &month)
	if err != nil {
		t.Fatalf("GetMonthlySummary failed: %v", err)
	}
	if got.TotalPenalty != 7 || len(got.TriggeredPenaltyRuleIds) != 1 || got.TriggeredPenaltyRuleIds[0] != "rule-5" {
		t.Fatalf("unexpected penalty summary: %+v", got)
	}
	if len(got.TaskStatusByDate) == 0 || got.TaskStatusByDate[0].Date.Time.Format(time.DateOnly) != "2026-05-13" {
		t.Fatalf("expected latest displayed day first, got %+v", got.TaskStatusByDate)
	}
	latestItems := got.TaskStatusByDate[0].Items
	if len(latestItems) != 1 || !latestItems[0].Completed || latestItems[0].CompletionSlots[0].Actor == nil {
		t.Fatalf("expected completed daily item with actor on latest day, got %+v", latestItems)
	}

	var weeklyItem *model.MonthlyTaskStatusItem
	for _, group := range got.TaskStatusByDate {
		if group.Date.Time.Format(time.DateOnly) != "2026-05-11" {
			continue
		}
		for i := range group.Items {
			if group.Items[i].TaskId == "weekly-1" {
				weeklyItem = &group.Items[i]
			}
		}
	}
	if weeklyItem == nil || !weeklyItem.Completed || len(weeklyItem.CompletionSlots) != 2 || weeklyItem.CompletionSlots[0].Actor == nil {
		t.Fatalf("expected completed weekly item with slots on week anchor, got %+v", weeklyItem)
	}
}
