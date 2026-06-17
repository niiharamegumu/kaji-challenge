package store

import (
	"context"
	"testing"
	"time"

	"github.com/megu/kaji-challenge/backend/internal/adapter/persistence/postgres/repositories"
	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
)

func TestBuildMonthlyTaskStatusByDateDailyOmitAfterDeleteTime(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	base := time.Date(2026, 1, 1, 9, 0, 0, 0, s.loc)
	teamID, userID := createTeamWithMember(t, s, "summary-daily-delete@example.com", base)
	taskID := createTaskAtWithID(t, s, teamID, model.TaskTypeDaily, 2, 1, base)

	if err := s.q.CreateTaskCompletionDaily(ctx, dbsqlc.CreateTaskCompletionDailyParams{
		TaskID:     taskID,
		TargetDate: toPgDate(time.Date(2026, 1, 10, 0, 0, 0, 0, s.loc)),
	}); err != nil {
		t.Fatalf("failed to create daily completion: %v", err)
	}

	deleteAt := time.Date(2026, 1, 10, 12, 0, 0, 0, s.loc)
	if _, err := s.db.Exec(ctx, `UPDATE tasks SET deleted_at = $2, updated_at = $2 WHERE id = $1`, taskID, deleteAt); err != nil {
		t.Fatalf("failed to soft delete task: %v", err)
	}

	groups, err := monthlyTaskStatusGroupsForTest(ctx, s, userID, "2026-01")
	if err != nil {
		t.Fatalf("buildMonthlyTaskStatusByDate failed: %v", err)
	}

	if containsTaskOnDate(groups, "2026-01-10", taskID) {
		t.Fatalf("task should be omitted on delete date after same-day delete")
	}
	if !containsTaskOnDate(groups, "2026-01-09", taskID) {
		t.Fatalf("task should remain visible before delete date")
	}
}

func TestBuildMonthlyTaskStatusByDateWeeklyOmitFromDeleteWeek(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	base := time.Date(2026, 1, 1, 9, 0, 0, 0, s.loc)
	teamID, userID := createTeamWithMember(t, s, "summary-weekly-delete@example.com", base)
	taskID := createTaskAtWithID(t, s, teamID, model.TaskTypeWeekly, 3, 1, base)

	if err := insertWeeklyCompletionEntriesForTest(ctx, s, taskID, time.Date(2026, 1, 5, 0, 0, 0, 0, s.loc), 1); err != nil {
		t.Fatalf("failed to create previous-week completion: %v", err)
	}
	if err := insertWeeklyCompletionEntriesForTest(ctx, s, taskID, time.Date(2026, 1, 12, 0, 0, 0, 0, s.loc), 1); err != nil {
		t.Fatalf("failed to create delete-week completion: %v", err)
	}

	deleteAt := time.Date(2026, 1, 15, 12, 0, 0, 0, s.loc)
	if _, err := s.db.Exec(ctx, `UPDATE tasks SET deleted_at = $2, updated_at = $2 WHERE id = $1`, taskID, deleteAt); err != nil {
		t.Fatalf("failed to soft delete task: %v", err)
	}

	groups, err := monthlyTaskStatusGroupsForTest(ctx, s, userID, "2026-01")
	if err != nil {
		t.Fatalf("buildMonthlyTaskStatusByDate failed: %v", err)
	}

	if containsTaskOnDate(groups, "2026-01-12", taskID) {
		t.Fatalf("weekly task should be omitted from the delete week")
	}
	if !containsTaskOnDate(groups, "2026-01-05", taskID) {
		t.Fatalf("weekly task should remain visible before delete week")
	}
}

func TestBuildMonthlyTaskStatusByDateWeeklyCrossMonthShownOnMonthStart(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	base := time.Date(2026, 1, 1, 9, 0, 0, 0, s.loc)
	teamID, userID := createTeamWithMember(t, s, "summary-weekly-cross-month@example.com", base)
	taskID := createTaskAtWithID(t, s, teamID, model.TaskTypeWeekly, 3, 1, base)

	if err := insertWeeklyCompletionEntriesForTest(ctx, s, taskID, time.Date(2025, 12, 29, 0, 0, 0, 0, s.loc), 1); err != nil {
		t.Fatalf("failed to create cross-month weekly completion: %v", err)
	}

	groups, err := monthlyTaskStatusGroupsForTest(ctx, s, userID, "2026-01")
	if err != nil {
		t.Fatalf("buildMonthlyTaskStatusByDate failed: %v", err)
	}

	if !containsTaskOnDate(groups, "2026-01-01", taskID) {
		t.Fatalf("weekly cross-month task should be shown on month start date")
	}
	completed, ok := taskCompletedOnDate(groups, "2026-01-01", taskID)
	if !ok {
		t.Fatalf("weekly cross-month task should exist on 2026-01-01")
	}
	if !completed {
		t.Fatalf("weekly cross-month task should be marked completed")
	}
}

func TestBuildMonthlyTaskStatusByDateIncludesNotes(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	base := time.Date(2026, 1, 1, 9, 0, 0, 0, s.loc)
	teamID, userID := createTeamWithMember(t, s, "summary-notes@example.com", base)
	notes := "食器を片付ける"
	taskID := createTaskAtWithIDAndNotes(t, s, teamID, model.TaskTypeDaily, 2, 1, base, &notes)

	groups, err := monthlyTaskStatusGroupsForTest(ctx, s, userID, "2026-01")
	if err != nil {
		t.Fatalf("buildMonthlyTaskStatusByDate failed: %v", err)
	}

	for _, group := range groups {
		for _, item := range group.Items {
			if item.TaskId != taskID {
				continue
			}
			if item.Notes == nil || *item.Notes != notes {
				t.Fatalf("expected notes to be propagated, got %#v", item.Notes)
			}
			return
		}
	}
	t.Fatalf("task not found in monthly status groups")
}

func TestBuildMonthlyTaskStatusByDateUsesTaskPositionOrder(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	base := time.Date(2026, 1, 1, 9, 0, 0, 0, s.loc)
	teamID, userID := createTeamWithMember(t, s, "summary-sort-key-order@example.com", base)
	firstID := createTaskAtWithIDAndTitle(t, s, teamID, model.TaskTypeDaily, 2, 1, base, "B-task", nil)
	secondID := createTaskAtWithIDAndTitle(t, s, teamID, model.TaskTypeDaily, 2, 1, base.Add(time.Minute), "A-task", nil)

	if _, err := s.ReorderTasks(withLatestIfMatchForUser(t, s, ctx, userID), userID, model.ReorderTasksRequest{
		TaskIds: []string{secondID, firstID},
	}); err != nil {
		t.Fatalf("failed to reorder tasks: %v", err)
	}

	groups, err := monthlyTaskStatusGroupsForTest(ctx, s, userID, "2026-01")
	if err != nil {
		t.Fatalf("buildMonthlyTaskStatusByDate failed: %v", err)
	}

	items := itemsOnDate(groups, "2026-01-01")
	if len(items) != 2 {
		t.Fatalf("expected 2 items on 2026-01-01, got %d", len(items))
	}
	if items[0].TaskId != secondID || items[1].TaskId != firstID {
		t.Fatalf("unexpected task order on monthly summary: %#v", items)
	}
}

func TestBuildMonthlyTaskStatusByDateLeavesNotesNilWhenEmpty(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	base := time.Date(2026, 1, 1, 9, 0, 0, 0, s.loc)
	teamID, userID := createTeamWithMember(t, s, "summary-notes-empty@example.com", base)
	taskID := createTaskAtWithID(t, s, teamID, model.TaskTypeDaily, 2, 1, base)

	groups, err := monthlyTaskStatusGroupsForTest(ctx, s, userID, "2026-01")
	if err != nil {
		t.Fatalf("buildMonthlyTaskStatusByDate failed: %v", err)
	}

	for _, group := range groups {
		for _, item := range group.Items {
			if item.TaskId != taskID {
				continue
			}
			if item.Notes != nil {
				t.Fatalf("expected notes to be nil, got %#v", item.Notes)
			}
			return
		}
	}
	t.Fatalf("task not found in monthly status groups")
}

func TestBuildMonthlyTaskStatusByDateCurrentMonthDoesNotIncludeFutureDates(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	now := time.Now().In(s.loc)
	today := dateOnly(now, s.loc)
	monthStart := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, s.loc)
	month := monthStart.Format("2006-01")

	teamID, userID := createTeamWithMember(t, s, "summary-current-month@example.com", monthStart.Add(9*time.Hour))
	taskID := createTaskAtWithID(t, s, teamID, model.TaskTypeDaily, 2, 1, monthStart.Add(9*time.Hour))

	groups, err := monthlyTaskStatusGroupsForTest(ctx, s, userID, month)
	if err != nil {
		t.Fatalf("buildMonthlyTaskStatusByDate failed: %v", err)
	}
	if len(groups) == 0 {
		t.Fatalf("expected current month groups to be non-empty")
	}

	todayKey := today.Format("2006-01-02")
	if !containsTaskOnDate(groups, todayKey, taskID) {
		t.Fatalf("expected task to appear on today (%s)", todayKey)
	}

	for _, group := range groups {
		groupDay := dateOnly(group.Date.In(s.loc), s.loc)
		if groupDay.After(today) {
			t.Fatalf("future date should not be included: %s > %s", groupDay.Format("2006-01-02"), todayKey)
		}
	}
}

func TestBuildMonthlyTaskStatusByDateFutureMonthReturnsEmpty(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	now := time.Now().In(s.loc)
	today := dateOnly(now, s.loc)
	thisMonthStart := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, s.loc)
	futureMonthStart := thisMonthStart.AddDate(0, 1, 0)
	futureMonth := futureMonthStart.Format("2006-01")

	teamID, userID := createTeamWithMember(t, s, "summary-future-month@example.com", today.Add(9*time.Hour))
	createTaskAtWithID(t, s, teamID, model.TaskTypeDaily, 2, 1, futureMonthStart.Add(9*time.Hour))

	groups, err := monthlyTaskStatusGroupsForTest(ctx, s, userID, futureMonth)
	if err != nil {
		t.Fatalf("buildMonthlyTaskStatusByDate failed: %v", err)
	}
	if len(groups) != 0 {
		t.Fatalf("expected no groups for future month, got %d", len(groups))
	}
}

func TestBuildMonthlyTaskStatusByDatePastMonthKeepsMonthEnd(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	now := time.Now().In(s.loc)
	today := dateOnly(now, s.loc)
	thisMonthStart := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, s.loc)
	pastMonthStart := thisMonthStart.AddDate(0, -1, 0)
	pastMonth := pastMonthStart.Format("2006-01")
	pastMonthLastDay := pastMonthStart.AddDate(0, 1, -1).Format("2006-01-02")

	teamID, userID := createTeamWithMember(t, s, "summary-past-month@example.com", pastMonthStart.Add(9*time.Hour))
	taskID := createTaskAtWithID(t, s, teamID, model.TaskTypeDaily, 2, 1, pastMonthStart.Add(9*time.Hour))

	groups, err := monthlyTaskStatusGroupsForTest(ctx, s, userID, pastMonth)
	if err != nil {
		t.Fatalf("buildMonthlyTaskStatusByDate failed: %v", err)
	}
	if !containsTaskOnDate(groups, pastMonthLastDay, taskID) {
		t.Fatalf("expected task on past month end date: %s", pastMonthLastDay)
	}
}

func monthlyTaskStatusGroupsForTest(ctx context.Context, s *Store, userID, month string) ([]model.MonthlyTaskStatusGroup, error) {
	summary, err := repositories.NewServices(s).TaskOverview.GetMonthlySummary(ctx, userID, &month)
	if err != nil {
		return nil, err
	}
	return summary.TaskStatusByDate, nil
}
