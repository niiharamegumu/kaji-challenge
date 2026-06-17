package store

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/megu/kaji-challenge/backend/internal/adapter/persistence/postgres/repositories"
	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
)

func TestGetTaskOverviewWeeklyRemindersSortsByDateThenCreatedAt(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	now := time.Date(2026, 4, 2, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }
	today := dateOnly(now, s.loc)
	teamID, userID := createTeamWithMember(t, s, "overview-reminders-sort@example.com", today.Add(9*time.Hour))

	laterDate := today.AddDate(0, 0, 1)
	createReminderAt(t, s, teamID, "z-later-date", model.OneTime, nil, today.Add(3*time.Hour), laterDate, nil)
	createReminderAt(t, s, teamID, "z-created-second", model.OneTime, nil, today.Add(time.Hour), today, nil)
	createReminderAt(t, s, teamID, "a-created-first", model.OneTime, nil, today.Add(30*time.Minute), today, nil)

	overview, err := repositories.NewServices(s).TaskOverview.GetTaskOverview(ctx, userID)
	if err != nil {
		t.Fatalf("GetTaskOverview failed: %v", err)
	}

	if len(overview.WeeklyReminders) < 3 {
		t.Fatalf("expected at least 3 weekly reminders, got %d", len(overview.WeeklyReminders))
	}

	if overview.WeeklyReminders[0].Title != "a-created-first" {
		t.Fatalf("expected first same-day reminder to be oldest created item, got %q", overview.WeeklyReminders[0].Title)
	}
	if overview.WeeklyReminders[1].Title != "z-created-second" {
		t.Fatalf("expected second same-day reminder to be second oldest created item, got %q", overview.WeeklyReminders[1].Title)
	}
	if overview.WeeklyReminders[2].Title != "z-later-date" {
		t.Fatalf("expected later-date reminder after same-day reminders, got %q", overview.WeeklyReminders[2].Title)
	}
}

func TestGetTaskOverviewUsesTaskPositionOrder(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	base := time.Date(2026, 3, 1, 9, 0, 0, 0, s.loc)
	_, userID := createTeamWithMember(t, s, "overview-task-order@example.com", base)
	teamID := teamIDForUser(t, s, userID)

	firstDailyID := createTaskWithIDAt(t, s, teamID, model.TaskTypeDaily, 1, 1, base)
	secondDailyID := createTaskWithIDAt(t, s, teamID, model.TaskTypeDaily, 2, 1, base.Add(time.Minute))
	firstWeeklyID := createTaskWithIDAt(t, s, teamID, model.TaskTypeWeekly, 3, 2, base.Add(2*time.Minute))
	secondWeeklyID := createTaskWithIDAt(t, s, teamID, model.TaskTypeWeekly, 4, 2, base.Add(3*time.Minute))

	if _, err := s.ReorderTasks(withLatestIfMatchForUser(t, s, ctx, userID), userID, model.ReorderTasksRequest{
		TaskIds: []string{secondDailyID, firstDailyID},
	}); err != nil {
		t.Fatalf("failed to reorder daily tasks: %v", err)
	}
	if _, err := s.ReorderTasks(withLatestIfMatchForUser(t, s, ctx, userID), userID, model.ReorderTasksRequest{
		TaskIds: []string{secondWeeklyID, firstWeeklyID},
	}); err != nil {
		t.Fatalf("failed to reorder weekly tasks: %v", err)
	}

	overview, err := repositories.NewServices(s).TaskOverview.GetTaskOverview(ctx, userID)
	if err != nil {
		t.Fatalf("GetTaskOverview failed: %v", err)
	}

	if len(overview.DailyTasks) != 2 {
		t.Fatalf("expected 2 daily tasks, got %d", len(overview.DailyTasks))
	}
	if overview.DailyTasks[0].Task.Id != secondDailyID || overview.DailyTasks[1].Task.Id != firstDailyID {
		t.Fatalf("unexpected daily task order: %#v", overview.DailyTasks)
	}

	if len(overview.WeeklyTasks) != 2 {
		t.Fatalf("expected 2 weekly tasks, got %d", len(overview.WeeklyTasks))
	}
	if overview.WeeklyTasks[0].Task.Id != secondWeeklyID || overview.WeeklyTasks[1].Task.Id != firstWeeklyID {
		t.Fatalf("unexpected weekly task order: %#v", overview.WeeklyTasks)
	}
}

func createTaskAtWithID(t *testing.T, s *Store, teamID string, taskType model.TaskType, penalty, required int, createdAt time.Time) string {
	t.Helper()
	return createTaskAtWithIDAndTitle(t, s, teamID, taskType, penalty, required, createdAt, "monthly status task", nil)
}

func createReminderAt(
	t *testing.T,
	s *Store,
	teamID string,
	title string,
	kind model.ReminderKind,
	scheduleType *model.ReminderScheduleType,
	createdAt time.Time,
	startDate time.Time,
	endDate *time.Time,
) string {
	t.Helper()
	reminderID := s.nextID("rem")
	if err := s.q.CreateReminder(context.Background(), dbsqlc.CreateReminderParams{
		ID:           reminderID,
		TeamID:       teamID,
		Title:        title,
		Notes:        pgtype.Text{},
		Kind:         string(kind),
		ScheduleType: textFromPtr(reminderScheduleTypeString(scheduleType)),
		StartDate:    toPgDate(startDate),
		EndDate:      pgDateFromPtr(endDate),
		CreatedAt:    toPgTimestamptz(createdAt),
		UpdatedAt:    toPgTimestamptz(createdAt),
	}); err != nil {
		t.Fatalf("failed to create reminder: %v", err)
	}
	return reminderID
}

func createTaskAtWithIDAndNotes(t *testing.T, s *Store, teamID string, taskType model.TaskType, penalty, required int, createdAt time.Time, notes *string) string {
	t.Helper()
	return createTaskAtWithIDAndTitle(t, s, teamID, taskType, penalty, required, createdAt, "monthly status task", notes)
}

func createTaskAtWithIDAndTitle(t *testing.T, s *Store, teamID string, taskType model.TaskType, penalty, required int, createdAt time.Time, title string, notes *string) string {
	t.Helper()
	taskID := s.nextID("task")
	notesValue := pgtype.Text{}
	if notes != nil {
		notesValue = pgtype.Text{String: *notes, Valid: true}
	}
	maxSortKey, err := s.q.GetTaskMaxSortKeyByTeamAndType(context.Background(), dbsqlc.GetTaskMaxSortKeyByTeamAndTypeParams{
		TeamID: teamID,
		Type:   string(taskType),
	})
	if err != nil {
		t.Fatalf("failed to get max task sort key: %v", err)
	}
	if err := s.q.CreateTask(context.Background(), dbsqlc.CreateTaskParams{
		ID:                         taskID,
		TeamID:                     teamID,
		Title:                      title,
		Notes:                      notesValue,
		Type:                       string(taskType),
		PenaltyPoints:              int32(penalty),
		Column7:                    "",
		RequiredCompletionsPerWeek: int32(required),
		SortKey:                    maxSortKey + sortKeyStep,
		CreatedAt:                  toPgTimestamptz(createdAt),
		UpdatedAt:                  toPgTimestamptz(createdAt),
	}); err != nil {
		t.Fatalf("failed to create task: %v", err)
	}
	return taskID
}

func itemsOnDate(groups []model.MonthlyTaskStatusGroup, date string) []model.MonthlyTaskStatusItem {
	for _, group := range groups {
		if group.Date.Format("2006-01-02") == date {
			return group.Items
		}
	}
	return nil
}

func containsTaskOnDate(groups []model.MonthlyTaskStatusGroup, date, taskID string) bool {
	for _, group := range groups {
		if group.Date.Format("2006-01-02") != date {
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

func taskCompletedOnDate(groups []model.MonthlyTaskStatusGroup, date, taskID string) (bool, bool) {
	for _, group := range groups {
		if group.Date.Format("2006-01-02") != date {
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
