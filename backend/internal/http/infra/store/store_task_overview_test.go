package store

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func TestBuildMonthlyTaskStatusByDateDailyOmitAfterDeleteTime(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	base := time.Date(2026, 1, 1, 9, 0, 0, 0, s.loc)
	teamID, _ := createTeamWithMember(t, s, "summary-daily-delete@example.com", base)
	taskID := createTaskAtWithID(t, s, teamID, api.Daily, 2, 1, base)

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

	groups, err := s.buildMonthlyTaskStatusByDate(ctx, teamID, "2026-01")
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
	teamID, _ := createTeamWithMember(t, s, "summary-weekly-delete@example.com", base)
	taskID := createTaskAtWithID(t, s, teamID, api.Weekly, 3, 1, base)

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

	groups, err := s.buildMonthlyTaskStatusByDate(ctx, teamID, "2026-01")
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
	teamID, _ := createTeamWithMember(t, s, "summary-weekly-cross-month@example.com", base)
	taskID := createTaskAtWithID(t, s, teamID, api.Weekly, 3, 1, base)

	if err := insertWeeklyCompletionEntriesForTest(ctx, s, taskID, time.Date(2025, 12, 29, 0, 0, 0, 0, s.loc), 1); err != nil {
		t.Fatalf("failed to create cross-month weekly completion: %v", err)
	}

	groups, err := s.buildMonthlyTaskStatusByDate(ctx, teamID, "2026-01")
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
	teamID, _ := createTeamWithMember(t, s, "summary-notes@example.com", base)
	notes := "食器を片付ける"
	taskID := createTaskAtWithIDAndNotes(t, s, teamID, api.Daily, 2, 1, base, &notes)

	groups, err := s.buildMonthlyTaskStatusByDate(ctx, teamID, "2026-01")
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

func TestBuildMonthlyTaskStatusByDateLeavesNotesNilWhenEmpty(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	base := time.Date(2026, 1, 1, 9, 0, 0, 0, s.loc)
	teamID, _ := createTeamWithMember(t, s, "summary-notes-empty@example.com", base)
	taskID := createTaskAtWithID(t, s, teamID, api.Daily, 2, 1, base)

	groups, err := s.buildMonthlyTaskStatusByDate(ctx, teamID, "2026-01")
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

func createTaskAtWithID(t *testing.T, s *Store, teamID string, taskType api.TaskType, penalty, required int, createdAt time.Time) string {
	t.Helper()
	return createTaskAtWithIDAndNotes(t, s, teamID, taskType, penalty, required, createdAt, nil)
}

func createTaskAtWithIDAndNotes(t *testing.T, s *Store, teamID string, taskType api.TaskType, penalty, required int, createdAt time.Time, notes *string) string {
	t.Helper()
	taskID := s.nextID("task")
	notesValue := pgtype.Text{}
	if notes != nil {
		notesValue = pgtype.Text{String: *notes, Valid: true}
	}
	if err := s.q.CreateTask(context.Background(), dbsqlc.CreateTaskParams{
		ID:                         taskID,
		TeamID:                     teamID,
		Title:                      "monthly status task",
		Notes:                      notesValue,
		Type:                       string(taskType),
		PenaltyPoints:              int32(penalty),
		Column7:                    "",
		RequiredCompletionsPerWeek: int32(required),
		CreatedAt:                  toPgTimestamptz(createdAt),
		UpdatedAt:                  toPgTimestamptz(createdAt),
	}); err != nil {
		t.Fatalf("failed to create task: %v", err)
	}
	return taskID
}

func containsTaskOnDate(groups []api.MonthlyTaskStatusGroup, date, taskID string) bool {
	for _, group := range groups {
		if group.Date.Time.Format("2006-01-02") != date {
			continue
		}
		for _, item := range group.Items {
			if item.TaskId == taskID {
				return true
			}
		}
	}
	return false
}

func taskCompletedOnDate(groups []api.MonthlyTaskStatusGroup, date, taskID string) (bool, bool) {
	for _, group := range groups {
		if group.Date.Time.Format("2006-01-02") != date {
			continue
		}
		for _, item := range group.Items {
			if item.TaskId == taskID {
				return item.Completed, true
			}
		}
	}
	return false, false
}

func insertWeeklyCompletionEntriesForTest(ctx context.Context, s *Store, taskID string, weekStart time.Time, count int) error {
	for idx := 0; idx < count; idx++ {
		if err := s.q.InsertTaskCompletionWeeklyEntry(ctx, dbsqlc.InsertTaskCompletionWeeklyEntryParams{
			ID:                s.nextID("twce-test"),
			TaskID:            taskID,
			WeekStart:         toPgDate(weekStart),
			CompletedByUserID: "",
		}); err != nil {
			return err
		}
	}
	return nil
}
