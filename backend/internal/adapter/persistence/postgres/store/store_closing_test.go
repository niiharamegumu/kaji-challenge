package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/megu/kaji-challenge/backend/internal/adapter/persistence/postgres/repositories"
	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	"github.com/megu/kaji-challenge/backend/internal/application/requestcontext"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
)

func TestListClosableTeamIDs(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	teamWithMemberA, _ := createTeamWithMember(t, s, "user-a@example.com", time.Date(2026, 1, 1, 0, 0, 0, 0, s.loc))
	teamOnly := s.nextID("team")
	if err := s.q.CreateTeam(ctx, dbsqlc.CreateTeamParams{
		ID:        teamOnly,
		Name:      "team only",
		CreatedAt: toPgTimestamptz(time.Date(2026, 1, 2, 0, 0, 0, 0, s.loc)),
	}); err != nil {
		t.Fatalf("failed to create team without member: %v", err)
	}
	teamWithMemberB, _ := createTeamWithMember(t, s, "user-b@example.com", time.Date(2026, 1, 3, 0, 0, 0, 0, s.loc))

	got, err := s.ListClosableTeamIDs(ctx)
	if err != nil {
		t.Fatalf("ListClosableTeamIDs failed: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 closable teams, got %d (%v)", len(got), got)
	}
	if got[0] != teamWithMemberA || got[1] != teamWithMemberB {
		t.Fatalf("unexpected team order: %v", got)
	}
}

func TestCloseDayForTeamIsIdempotent(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	admin := repositories.NewServices(s).Admin

	teamID, _ := createTeamWithMember(t, s, "daily@example.com", time.Now().In(s.loc))
	createTask(t, s, teamID, model.TaskTypeDaily, 7, 1)

	if _, err := admin.CloseDayForTeam(ctx, teamID); err != nil {
		t.Fatalf("first CloseDayForTeam failed: %v", err)
	}
	if _, err := admin.CloseDayForTeam(ctx, teamID); err != nil {
		t.Fatalf("second CloseDayForTeam failed: %v", err)
	}

	row := getCurrentMonthSummary(t, s, teamID)
	if row.DailyPenaltyTotal != 7 {
		t.Fatalf("expected daily penalty total=7, got %d", row.DailyPenaltyTotal)
	}
}

func TestCloseWeekForTeamIsIdempotent(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	admin := repositories.NewServices(s).Admin

	now := time.Date(2026, 1, 3, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }
	thisWeekStart := startOfWeek(dateOnly(now, s.loc), s.loc)
	base := thisWeekStart.AddDate(0, 0, -6)
	teamID, _ := createTeamWithMember(t, s, "weekly@example.com", base)
	createTaskAt(t, s, teamID, model.TaskTypeWeekly, 5, 2, base)

	weekResA, err := admin.CloseWeekForTeam(ctx, teamID)
	if err != nil {
		t.Fatalf("first CloseWeekForTeam failed: %v", err)
	}
	weekResB, err := admin.CloseWeekForTeam(ctx, teamID)
	if err != nil {
		t.Fatalf("second CloseWeekForTeam failed: %v", err)
	}
	if weekResA.Month != weekResB.Month {
		t.Fatalf("expected same week close month, got %s and %s", weekResA.Month, weekResB.Month)
	}

	row := getMonthSummary(t, s, teamID, monthKeyFromTime(thisWeekStart.AddDate(0, 0, -1), s.loc))
	if row.WeeklyPenaltyTotal != 5 {
		t.Fatalf("expected weekly penalty total=5, got %d", row.WeeklyPenaltyTotal)
	}
}

func TestToggleTaskCompletionCompletesPastDailyTaskInOpenMonthAndRecalculatesPenalty(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 3, 17, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }

	createdAt := dateOnly(now, s.loc).AddDate(0, 0, -2).Add(10 * time.Hour)
	teamID, userID := createTeamWithMember(t, s, "past-daily-open@example.com", createdAt)
	taskID := createTaskWithIDAt(t, s, teamID, model.TaskTypeDaily, 4, 1, createdAt)
	targetDate := dateOnly(now, s.loc).AddDate(0, 0, -1)

	if _, err := s.closeDayForTargetLocked(ctx, targetDate, teamID); err != nil {
		t.Fatalf("closeDayForTargetLocked failed: %v", err)
	}

	before := getMonthSummary(t, s, teamID, monthKeyFromTime(targetDate, s.loc))
	if before.DailyPenaltyTotal != 4 {
		t.Fatalf("expected daily penalty total=4 before completion, got %d", before.DailyPenaltyTotal)
	}

	action := model.Complete
	res, err := s.ToggleTaskCompletion(withLatestIfMatchForUser(t, s, ctx, userID), userID, taskID, targetDate, &action)
	if err != nil {
		t.Fatalf("ToggleTaskCompletion failed: %v", err)
	}
	if !res.Completed {
		t.Fatalf("expected completion response to be completed")
	}

	after := getMonthSummary(t, s, teamID, monthKeyFromTime(targetDate, s.loc))
	if after.DailyPenaltyTotal != 0 {
		t.Fatalf("expected daily penalty total=0 after completion, got %d", after.DailyPenaltyTotal)
	}
}

func TestToggleTaskCompletionDecrementsPastDailyTaskInOpenMonthAndRecalculatesPenalty(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 3, 17, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }

	createdAt := dateOnly(now, s.loc).AddDate(0, 0, -2).Add(10 * time.Hour)
	teamID, userID := createTeamWithMember(t, s, "past-daily-decrement@example.com", createdAt)
	taskID := createTaskWithIDAt(t, s, teamID, model.TaskTypeDaily, 4, 1, createdAt)
	targetDate := dateOnly(now, s.loc).AddDate(0, 0, -1)
	if err := s.q.CreateTaskCompletionDaily(ctx, dbsqlc.CreateTaskCompletionDailyParams{
		TaskID:            taskID,
		TargetDate:        toPgDate(targetDate),
		CompletedByUserID: userID,
	}); err != nil {
		t.Fatalf("failed to seed daily completion: %v", err)
	}
	if _, err := s.closeDayForTargetLocked(ctx, targetDate, teamID); err != nil {
		t.Fatalf("closeDayForTargetLocked failed: %v", err)
	}

	before := getMonthSummary(t, s, teamID, monthKeyFromTime(targetDate, s.loc))
	if before.DailyPenaltyTotal != 0 {
		t.Fatalf("expected daily penalty total=0 before decrement, got %d", before.DailyPenaltyTotal)
	}
	action := model.Decrement
	res, err := s.ToggleTaskCompletion(withLatestIfMatchForUser(t, s, ctx, userID), userID, taskID, targetDate, &action)
	if err != nil {
		t.Fatalf("ToggleTaskCompletion failed: %v", err)
	}
	if res.Completed {
		t.Fatalf("expected completion response to be incomplete")
	}

	after := getMonthSummary(t, s, teamID, monthKeyFromTime(targetDate, s.loc))
	if after.DailyPenaltyTotal != 4 {
		t.Fatalf("expected daily penalty total=4 after decrement, got %d", after.DailyPenaltyTotal)
	}
}

func TestToggleTaskCompletionIncrementsPastWeeklyTaskInOpenMonthAndRecalculatesPenalty(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 3, 17, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }

	weekStart := time.Date(2026, 3, 9, 0, 0, 0, 0, s.loc)
	createdAt := weekStart.AddDate(0, 0, -2).Add(10 * time.Hour)
	teamID, userID := createTeamWithMember(t, s, "past-weekly-open@example.com", createdAt)
	taskID := createTaskWithIDAt(t, s, teamID, model.TaskTypeWeekly, 4, 2, createdAt)
	if err := s.q.InsertTaskCompletionWeeklyEntry(ctx, dbsqlc.InsertTaskCompletionWeeklyEntryParams{
		ID:                s.nextID("twce"),
		TaskID:            taskID,
		WeekStart:         toPgDate(weekStart),
		CompletedByUserID: userID,
	}); err != nil {
		t.Fatalf("failed to seed weekly completion: %v", err)
	}
	if _, err := s.closeWeekForTargetLocked(ctx, weekStart, teamID); err != nil {
		t.Fatalf("closeWeekForTargetLocked failed: %v", err)
	}

	before := getMonthSummary(t, s, teamID, "2026-03")
	if before.WeeklyPenaltyTotal != 4 {
		t.Fatalf("expected weekly penalty total=4 before completion, got %d", before.WeeklyPenaltyTotal)
	}
	action := model.Increment
	res, err := s.ToggleTaskCompletion(withLatestIfMatchForUser(t, s, ctx, userID), userID, taskID, weekStart, &action)
	if err != nil {
		t.Fatalf("ToggleTaskCompletion failed: %v", err)
	}
	if res.WeeklyCompletedCount != 2 || !res.Completed {
		t.Fatalf("unexpected completion response: %+v", res)
	}

	after := getMonthSummary(t, s, teamID, "2026-03")
	if after.WeeklyPenaltyTotal != 0 {
		t.Fatalf("expected weekly penalty total=0 after completion, got %d", after.WeeklyPenaltyTotal)
	}
}

func TestToggleTaskCompletionDecrementsPastWeeklyTaskInOpenMonthAndRecalculatesPenalty(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 3, 17, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }

	weekStart := time.Date(2026, 3, 9, 0, 0, 0, 0, s.loc)
	createdAt := weekStart.AddDate(0, 0, -2).Add(10 * time.Hour)
	teamID, userID := createTeamWithMember(t, s, "past-weekly-decrement@example.com", createdAt)
	taskID := createTaskWithIDAt(t, s, teamID, model.TaskTypeWeekly, 4, 2, createdAt)
	for range 2 {
		if err := s.q.InsertTaskCompletionWeeklyEntry(ctx, dbsqlc.InsertTaskCompletionWeeklyEntryParams{
			ID:                s.nextID("twce"),
			TaskID:            taskID,
			WeekStart:         toPgDate(weekStart),
			CompletedByUserID: userID,
		}); err != nil {
			t.Fatalf("failed to seed weekly completion: %v", err)
		}
	}
	if _, err := s.closeWeekForTargetLocked(ctx, weekStart, teamID); err != nil {
		t.Fatalf("closeWeekForTargetLocked failed: %v", err)
	}

	action := model.Decrement
	res, err := s.ToggleTaskCompletion(withLatestIfMatchForUser(t, s, ctx, userID), userID, taskID, weekStart, &action)
	if err != nil {
		t.Fatalf("ToggleTaskCompletion failed: %v", err)
	}
	if res.WeeklyCompletedCount != 1 || res.Completed {
		t.Fatalf("unexpected completion response: %+v", res)
	}

	after := getMonthSummary(t, s, teamID, "2026-03")
	if after.WeeklyPenaltyTotal != 4 {
		t.Fatalf("expected weekly penalty total=4 after decrement, got %d", after.WeeklyPenaltyTotal)
	}
}

func TestToggleTaskCompletionRestoresPastWeeklyPenaltyAfterCompletionIsReverted(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 3, 17, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }

	weekStart := time.Date(2026, 3, 9, 0, 0, 0, 0, s.loc)
	createdAt := weekStart.AddDate(0, 0, -2).Add(10 * time.Hour)
	teamID, userID := createTeamWithMember(t, s, "past-weekly-restore-penalty@example.com", createdAt)
	taskID := createTaskWithIDAt(t, s, teamID, model.TaskTypeWeekly, 3, 1, createdAt)
	if _, err := s.closeWeekForTargetLocked(ctx, weekStart, teamID); err != nil {
		t.Fatalf("closeWeekForTargetLocked failed: %v", err)
	}

	if got := getMonthSummary(t, s, teamID, "2026-03").WeeklyPenaltyTotal; got != 3 {
		t.Fatalf("expected weekly penalty total=3 after close, got %d", got)
	}

	increment := model.Increment
	if _, err := s.ToggleTaskCompletion(withLatestIfMatchForUser(t, s, ctx, userID), userID, taskID, weekStart, &increment); err != nil {
		t.Fatalf("increment past weekly completion failed: %v", err)
	}
	if got := getMonthSummary(t, s, teamID, "2026-03").WeeklyPenaltyTotal; got != 0 {
		t.Fatalf("expected weekly penalty total=0 after completion, got %d", got)
	}

	decrement := model.Decrement
	if _, err := s.ToggleTaskCompletion(withLatestIfMatchForUser(t, s, ctx, userID), userID, taskID, weekStart, &decrement); err != nil {
		t.Fatalf("decrement past weekly completion failed: %v", err)
	}
	if got := getMonthSummary(t, s, teamID, "2026-03").WeeklyPenaltyTotal; got != 3 {
		t.Fatalf("expected weekly penalty total=3 after completion was reverted, got %d", got)
	}
}

func TestToggleTaskCompletionIncrementsCrossMonthPastWeeklyTaskForWeekEndMonth(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 3, 10, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }

	weekStart := time.Date(2026, 2, 23, 0, 0, 0, 0, s.loc)
	createdAt := weekStart.AddDate(0, 0, -2).Add(10 * time.Hour)
	teamID, userID := createTeamWithMember(t, s, "past-weekly-cross-month@example.com", createdAt)
	taskID := createTaskWithIDAt(t, s, teamID, model.TaskTypeWeekly, 3, 1, createdAt)
	if _, err := s.closeWeekForTargetLocked(ctx, weekStart, teamID); err != nil {
		t.Fatalf("closeWeekForTargetLocked failed: %v", err)
	}

	action := model.Increment
	if _, err := s.ToggleTaskCompletion(withLatestIfMatchForUser(t, s, ctx, userID), userID, taskID, time.Date(2026, 3, 1, 0, 0, 0, 0, s.loc), &action); err != nil {
		t.Fatalf("ToggleTaskCompletion failed: %v", err)
	}
	after := getMonthSummary(t, s, teamID, "2026-03")
	if after.WeeklyPenaltyTotal != 0 {
		t.Fatalf("expected cross-month weekly penalty total=0 after completion, got %d", after.WeeklyPenaltyTotal)
	}
}

func TestToggleTaskCompletionRejectsPastDailyToggleAction(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 3, 17, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }

	createdAt := dateOnly(now, s.loc).AddDate(0, 0, -2).Add(10 * time.Hour)
	teamID, userID := createTeamWithMember(t, s, "past-daily-toggle@example.com", createdAt)
	taskID := createTaskWithIDAt(t, s, teamID, model.TaskTypeDaily, 2, 1, createdAt)
	targetDate := dateOnly(now, s.loc).AddDate(0, 0, -1)
	action := model.Toggle

	if _, err := s.ToggleTaskCompletion(withLatestIfMatchForUser(t, s, ctx, userID), userID, taskID, targetDate, &action); err == nil {
		t.Fatalf("expected ToggleTaskCompletion to reject toggle action for past daily task")
	}
}

func TestToggleTaskCompletionAllowsPastDailyCompleteForClosedMonth(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 3, 17, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }

	createdAt := dateOnly(now, s.loc).AddDate(0, 0, -2).Add(10 * time.Hour)
	teamID, userID := createTeamWithMember(t, s, "past-daily-closed@example.com", createdAt)
	taskID := createTaskWithIDAt(t, s, teamID, model.TaskTypeDaily, 2, 1, createdAt)
	targetDate := dateOnly(now, s.loc).AddDate(0, 0, -1)
	monthStart, err := monthStartFromKey(monthKeyFromTime(targetDate, s.loc), s.loc)
	if err != nil {
		t.Fatalf("monthStartFromKey failed: %v", err)
	}
	if err := s.q.UpsertMonthlyPenaltySummary(ctx, dbsqlc.UpsertMonthlyPenaltySummaryParams{
		TeamID:             teamID,
		MonthStart:         toPgDate(monthStart),
		DailyPenaltyTotal:  0,
		WeeklyPenaltyTotal: 0,
		IsClosed:           true,
	}); err != nil {
		t.Fatalf("failed to seed closed monthly summary: %v", err)
	}

	action := model.Complete
	if _, err := s.ToggleTaskCompletion(withLatestIfMatchForUser(t, s, ctx, userID), userID, taskID, targetDate, &action); err != nil {
		t.Fatalf("expected closed-month correction to succeed: %v", err)
	}
	if row := getMonthSummary(t, s, teamID, monthKeyFromTime(targetDate, s.loc)); !row.IsClosed {
		t.Fatalf("expected corrected month to remain closed")
	}
}

func TestToggleTaskCompletionCompleteIsIdempotentForPastDailyTask(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 3, 17, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }

	createdAt := dateOnly(now, s.loc).AddDate(0, 0, -2).Add(10 * time.Hour)
	teamID, userID := createTeamWithMember(t, s, "past-daily-idempotent@example.com", createdAt)
	taskID := createTaskWithIDAt(t, s, teamID, model.TaskTypeDaily, 3, 1, createdAt)
	targetDate := dateOnly(now, s.loc).AddDate(0, 0, -1)

	if _, err := s.closeDayForTargetLocked(ctx, targetDate, teamID); err != nil {
		t.Fatalf("closeDayForTargetLocked failed: %v", err)
	}

	action := model.Complete
	if _, err := s.ToggleTaskCompletion(withLatestIfMatchForUser(t, s, ctx, userID), userID, taskID, targetDate, &action); err != nil {
		t.Fatalf("first ToggleTaskCompletion failed: %v", err)
	}
	first := getMonthSummary(t, s, teamID, monthKeyFromTime(targetDate, s.loc))

	if _, err := s.ToggleTaskCompletion(withLatestIfMatchForUser(t, s, ctx, userID), userID, taskID, targetDate, &action); err != nil {
		t.Fatalf("second ToggleTaskCompletion failed: %v", err)
	}
	second := getMonthSummary(t, s, teamID, monthKeyFromTime(targetDate, s.loc))

	if first.DailyPenaltyTotal != second.DailyPenaltyTotal {
		t.Fatalf("expected idempotent daily penalty totals, got %d then %d", first.DailyPenaltyTotal, second.DailyPenaltyTotal)
	}
}

func TestToggleTaskCompletionRejectsFutureDailyComplete(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 3, 17, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }

	createdAt := dateOnly(now, s.loc).AddDate(0, 0, -2).Add(10 * time.Hour)
	teamID, userID := createTeamWithMember(t, s, "past-daily-future@example.com", createdAt)
	taskID := createTaskWithIDAt(t, s, teamID, model.TaskTypeDaily, 2, 1, createdAt)
	targetDate := dateOnly(now, s.loc).AddDate(0, 0, 1)
	action := model.Complete

	if _, err := s.ToggleTaskCompletion(withLatestIfMatchForUser(t, s, ctx, userID), userID, taskID, targetDate, &action); err == nil {
		t.Fatalf("expected ToggleTaskCompletion to reject future daily task completion")
	}
}

func TestToggleTaskCompletionAllowsPreviousMonthDailyComplete(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 3, 17, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }

	createdAt := time.Date(2026, 2, 27, 10, 0, 0, 0, s.loc)
	teamID, userID := createTeamWithMember(t, s, "past-daily-prev-month@example.com", createdAt)
	taskID := createTaskWithIDAt(t, s, teamID, model.TaskTypeDaily, 2, 1, createdAt)
	targetDate := time.Date(2026, 2, 28, 0, 0, 0, 0, s.loc)
	action := model.Complete

	if _, err := s.ToggleTaskCompletion(withLatestIfMatchForUser(t, s, ctx, userID), userID, taskID, targetDate, &action); err != nil {
		t.Fatalf("expected previous-month daily completion to succeed: %v", err)
	}
}

func TestCatchUpDayLockedProcessesMissingDays(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 12, 0, 0, 0, s.loc)
	admin := repositories.NewServices(s).Admin

	teamID, _ := createTeamWithMember(t, s, "catchup-day@example.com", base)
	createTaskAt(t, s, teamID, model.TaskTypeDaily, 2, 1, base)

	if _, err := s.closeDayForTargetLocked(ctx, time.Date(2026, 1, 1, 0, 0, 0, 0, s.loc), teamID); err != nil {
		t.Fatalf("initial closeDayForTargetLocked failed: %v", err)
	}

	s.now = func() time.Time { return time.Date(2026, 1, 5, 9, 0, 0, 0, s.loc) }
	if _, err := admin.CloseDayForTeam(ctx, teamID); err != nil {
		t.Fatalf("CloseDayForTeam failed: %v", err)
	}

	jan := getMonthSummary(t, s, teamID, "2026-01")
	if jan.DailyPenaltyTotal != 8 {
		t.Fatalf("expected daily total=8 after catch-up, got %d", jan.DailyPenaltyTotal)
	}
}

func withLatestIfMatchForUser(t *testing.T, s *Store, ctx context.Context, userID string) context.Context {
	t.Helper()
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		t.Fatalf("failed to load team for user: %v", err)
	}
	revision, err := s.q.GetTeamStateRevision(ctx, teamID)
	if err != nil {
		t.Fatalf("failed to load state revision: %v", err)
	}
	return requestcontext.WithIfMatch(ctx, etagFromRevision(teamID, revision))
}

func TestCatchUpDayLockedUsesTargetTimeTaskSnapshot(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 12, 0, 0, 0, s.loc)
	admin := repositories.NewServices(s).Admin

	teamID, _ := createTeamWithMember(t, s, "snapshot-day@example.com", base)
	createTaskAt(t, s, teamID, model.TaskTypeDaily, 1, 1, time.Date(2026, 1, 1, 10, 0, 0, 0, s.loc))

	if _, err := s.closeDayForTargetLocked(ctx, time.Date(2026, 1, 1, 0, 0, 0, 0, s.loc), teamID); err != nil {
		t.Fatalf("initial closeDayForTargetLocked failed: %v", err)
	}

	// This task is created on 1/3 noon. It must not affect targetDate=1/2 (cutoff=1/3 00:00).
	createTaskAt(t, s, teamID, model.TaskTypeDaily, 1, 1, time.Date(2026, 1, 3, 12, 0, 0, 0, s.loc))

	s.now = func() time.Time { return time.Date(2026, 1, 4, 9, 0, 0, 0, s.loc) }
	if _, err := admin.CloseDayForTeam(ctx, teamID); err != nil {
		t.Fatalf("CloseDayForTeam failed: %v", err)
	}

	jan := getMonthSummary(t, s, teamID, "2026-01")
	// first task: 1/1,1/2,1/3 => 3 points
	// second task: only 1/3 => 1 point
	if jan.DailyPenaltyTotal != 4 {
		t.Fatalf("expected daily total=4 with snapshot-aware catch-up, got %d", jan.DailyPenaltyTotal)
	}
}

func TestCatchUpWeekLockedProcessesMissingWeeks(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 12, 0, 0, 0, s.loc)
	admin := repositories.NewServices(s).Admin

	teamID, _ := createTeamWithMember(t, s, "catchup-week@example.com", base)
	createTaskAt(t, s, teamID, model.TaskTypeWeekly, 3, 2, base)

	if _, err := s.closeWeekForTargetLocked(ctx, time.Date(2026, 1, 5, 0, 0, 0, 0, s.loc), teamID); err != nil {
		t.Fatalf("initial closeWeekForTargetLocked failed: %v", err)
	}

	s.now = func() time.Time { return time.Date(2026, 2, 4, 9, 0, 0, 0, s.loc) }
	if _, err := admin.CloseWeekForTeam(ctx, teamID); err != nil {
		t.Fatalf("CloseWeekForTeam failed: %v", err)
	}

	jan := getMonthSummary(t, s, teamID, "2026-01")
	if jan.WeeklyPenaltyTotal != 9 {
		t.Fatalf("expected weekly total=9 in 2026-01 after catch-up, got %d", jan.WeeklyPenaltyTotal)
	}

	feb := getMonthSummary(t, s, teamID, "2026-02")
	if feb.WeeklyPenaltyTotal != 3 {
		t.Fatalf("expected weekly total=3 in 2026-02 after catch-up, got %d", feb.WeeklyPenaltyTotal)
	}
}

func TestCloseWeekForTargetLockedAddsPenaltyToWeekEndMonth(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	createdAt := time.Date(2026, 1, 1, 10, 0, 0, 0, s.loc)
	teamID, userID := createTeamWithMember(t, s, "week-end-month@example.com", createdAt)
	createTaskAt(t, s, teamID, model.TaskTypeWeekly, 4, 1, createdAt)

	didRun, err := s.closeWeekForTargetLocked(ctx, time.Date(2025, 12, 29, 0, 0, 0, 0, s.loc), teamID)
	if err != nil {
		t.Fatalf("closeWeekForTargetLocked failed: %v", err)
	}
	if !didRun {
		t.Fatalf("expected closeWeekForTargetLocked to run")
	}

	jan := getMonthSummary(t, s, teamID, "2026-01")
	if jan.WeeklyPenaltyTotal != 4 {
		t.Fatalf("expected weekly total=4 in 2026-01, got %d", jan.WeeklyPenaltyTotal)
	}

	targetMonth := "2026-01"
	apiSummary, err := repositories.NewServices(s).TaskOverview.GetMonthlySummary(ctx, userID, &targetMonth)
	if err != nil {
		t.Fatalf("GetMonthlySummary failed: %v", err)
	}
	if apiSummary.WeeklyPenaltyTotal != 4 {
		t.Fatalf("expected api weekly total=4 in 2026-01, got %d", apiSummary.WeeklyPenaltyTotal)
	}
	if apiSummary.TotalPenalty != 4 {
		t.Fatalf("expected api total penalty=4 in 2026-01, got %d", apiSummary.TotalPenalty)
	}
}

func TestCloseDayForTargetLockedFailsWhenMonthAlreadyClosed(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	createdAt := time.Date(2025, 12, 15, 10, 0, 0, 0, s.loc)
	teamID, _ := createTeamWithMember(t, s, "closed-month-day@example.com", createdAt)
	createTaskAt(t, s, teamID, model.TaskTypeDaily, 2, 1, createdAt)

	if err := s.q.UpsertMonthlyPenaltySummary(ctx, dbsqlc.UpsertMonthlyPenaltySummaryParams{
		TeamID: teamID, MonthStart: toPgDate(time.Date(2025, 12, 1, 0, 0, 0, 0, s.loc)), IsClosed: true,
	}); err != nil {
		t.Fatalf("failed to seed closed month: %v", err)
	}

	_, err := s.closeDayForTargetLocked(ctx, time.Date(2025, 12, 31, 0, 0, 0, 0, s.loc), teamID)
	if !errors.Is(err, errMonthAlreadyClosed) {
		t.Fatalf("expected errMonthAlreadyClosed, got %v", err)
	}

	latest, latestErr := s.q.GetLatestCloseRunTargetDate(ctx, dbsqlc.GetLatestCloseRunTargetDateParams{
		TeamID: teamID,
		Scope:  "close_day",
	})
	if latestErr != nil {
		t.Fatalf("GetLatestCloseRunTargetDate failed: %v", latestErr)
	}
	if latest.Valid {
		t.Fatalf("close_day run must not be recorded when month is already closed")
	}
}

func TestCloseWeekForTargetLockedFailsWhenTargetMonthAlreadyClosed(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	createdAt := time.Date(2026, 1, 1, 10, 0, 0, 0, s.loc)
	teamID, _ := createTeamWithMember(t, s, "closed-month-week@example.com", createdAt)
	createTaskAt(t, s, teamID, model.TaskTypeWeekly, 3, 1, createdAt)

	if err := s.q.UpsertMonthlyPenaltySummary(ctx, dbsqlc.UpsertMonthlyPenaltySummaryParams{
		TeamID: teamID, MonthStart: toPgDate(time.Date(2026, 1, 1, 0, 0, 0, 0, s.loc)), IsClosed: true,
	}); err != nil {
		t.Fatalf("failed to seed closed month: %v", err)
	}

	_, err := s.closeWeekForTargetLocked(ctx, time.Date(2025, 12, 29, 0, 0, 0, 0, s.loc), teamID)
	if !errors.Is(err, errMonthAlreadyClosed) {
		t.Fatalf("expected errMonthAlreadyClosed, got %v", err)
	}

	latest, latestErr := s.q.GetLatestCloseRunTargetDate(ctx, dbsqlc.GetLatestCloseRunTargetDateParams{
		TeamID: teamID,
		Scope:  "close_week",
	})
	if latestErr != nil {
		t.Fatalf("GetLatestCloseRunTargetDate failed: %v", latestErr)
	}
	if latest.Valid {
		t.Fatalf("close_week run must not be recorded when month is already closed")
	}
}

func TestReplaceTriggeredRulesUsesCurrentRules(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	createdAt := time.Date(2026, 1, 1, 9, 0, 0, 0, s.loc)
	teamID, _ := createTeamWithMember(t, s, "rule-snapshot-close@example.com", createdAt)
	monthStart := time.Date(2026, 1, 1, 0, 0, 0, 0, s.loc)

	if err := s.q.UpsertMonthlyPenaltySummary(ctx, dbsqlc.UpsertMonthlyPenaltySummaryParams{
		TeamID:             teamID,
		MonthStart:         toPgDate(monthStart),
		DailyPenaltyTotal:  10,
		WeeklyPenaltyTotal: 0,
		IsClosed:           false,
	}); err != nil {
		t.Fatalf("failed to seed monthly summary: %v", err)
	}

	ruleDeletedBeforeMonthEnd := createPenaltyRuleAt(t, s, teamID, 5, "削除済みルール", createdAt)
	softDeletePenaltyRuleAt(t, s, ruleDeletedBeforeMonthEnd, time.Date(2026, 1, 20, 0, 0, 0, 0, s.loc))
	ruleActiveAtMonthEnd := createPenaltyRuleAt(t, s, teamID, 8, "有効ルール", createdAt)

	if err := s.replaceTriggeredRulesLocked(ctx, teamID, monthStart, 10); err != nil {
		t.Fatalf("replaceTriggeredRulesLocked failed: %v", err)
	}

	triggered, err := s.q.ListTriggeredRuleIDsByMonth(ctx, dbsqlc.ListTriggeredRuleIDsByMonthParams{
		TeamID:     teamID,
		MonthStart: toPgDate(monthStart),
	})
	if err != nil {
		t.Fatalf("ListTriggeredRuleIDsByMonth failed: %v", err)
	}
	if len(triggered) != 1 || triggered[0] != ruleActiveAtMonthEnd {
		t.Fatalf("expected only active-at-month-end rule to trigger, got %v", triggered)
	}
}

func TestGetMonthlySummaryUsesAsOfSnapshotForUnclosedMonth(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	createdAt := time.Date(2026, 1, 1, 9, 0, 0, 0, s.loc)
	teamID, userID := createTeamWithMember(t, s, "rule-snapshot-summary@example.com", createdAt)
	monthStart := time.Date(2026, 1, 1, 0, 0, 0, 0, s.loc)

	if err := s.q.UpsertMonthlyPenaltySummary(ctx, dbsqlc.UpsertMonthlyPenaltySummaryParams{
		TeamID:             teamID,
		MonthStart:         toPgDate(monthStart),
		DailyPenaltyTotal:  10,
		WeeklyPenaltyTotal: 0,
		IsClosed:           false,
	}); err != nil {
		t.Fatalf("failed to seed monthly summary: %v", err)
	}

	ruleDeletedBeforeMonthEnd := createPenaltyRuleAt(t, s, teamID, 5, "削除済みルール", createdAt)
	softDeletePenaltyRuleAt(t, s, ruleDeletedBeforeMonthEnd, time.Date(2026, 1, 20, 0, 0, 0, 0, s.loc))
	ruleDeletedAfterMonthEnd := createPenaltyRuleAt(t, s, teamID, 8, "翌月削除ルール", createdAt)
	softDeletePenaltyRuleAt(t, s, ruleDeletedAfterMonthEnd, time.Date(2026, 2, 2, 0, 0, 0, 0, s.loc))

	targetMonth := "2026-01"
	summary, err := repositories.NewServices(s).TaskOverview.GetMonthlySummary(ctx, userID, &targetMonth)
	if err != nil {
		t.Fatalf("GetMonthlySummary failed: %v", err)
	}

	if len(summary.TriggeredPenaltyRuleIds) != 1 || summary.TriggeredPenaltyRuleIds[0] != ruleDeletedAfterMonthEnd {
		t.Fatalf("expected only rule effective at month end to trigger, got %v", summary.TriggeredPenaltyRuleIds)
	}
}

func TestMonthCloseCandidateAdvancesOneMonthAtATime(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	teamID, _ := createTeamWithMember(t, s, "catchup-month@example.com", time.Date(2025, 11, 15, 10, 0, 0, 0, s.loc))
	createTaskAt(t, s, teamID, model.TaskTypeDaily, 1, 1, time.Date(2025, 11, 15, 10, 0, 0, 0, s.loc))

	s.now = func() time.Time { return time.Date(2026, 2, 10, 9, 0, 0, 0, s.loc) }
	for index, month := range []string{"2025-11", "2025-12", "2026-01"} {
		candidate, err := s.GetMonthCloseCandidate(ctx, teamID)
		if err != nil {
			t.Fatalf("GetMonthCloseCandidate failed: %v", err)
		}
		if candidate.Candidate == nil || candidate.Candidate.Month != month {
			t.Fatalf("expected candidate %s, got %+v", month, candidate.Candidate)
		}
		if candidate.PendingMonthCount != 3-index {
			t.Fatalf("expected %d pending months, got %d", 3-index, candidate.PendingMonthCount)
		}
		if err := s.runInTransaction(ctx, func(txCtx context.Context) error {
			return s.FinalizeMonth(txCtx, teamID, month)
		}); err != nil {
			t.Fatalf("FinalizeMonth(%s) failed: %v", month, err)
		}
	}
	candidate, err := s.GetMonthCloseCandidate(ctx, teamID)
	if err != nil || candidate.Candidate != nil || candidate.PendingMonthCount != 0 {
		t.Fatalf("expected no candidate after closing all months, got %+v err=%v", candidate, err)
	}
}
