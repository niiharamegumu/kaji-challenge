package store

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
	"github.com/megu/kaji-challenge/backend/internal/testutil/dbtest"
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

	teamID, _ := createTeamWithMember(t, s, "daily@example.com", time.Now().In(s.loc))
	createTask(t, s, teamID, api.Daily, 7, 1)

	if _, err := s.CloseDayForTeam(ctx, teamID); err != nil {
		t.Fatalf("first CloseDayForTeam failed: %v", err)
	}
	if _, err := s.CloseDayForTeam(ctx, teamID); err != nil {
		t.Fatalf("second CloseDayForTeam failed: %v", err)
	}

	row := getCurrentMonthSummary(t, s, teamID)
	if row.DailyPenaltyTotal != 7 {
		t.Fatalf("expected daily penalty total=7, got %d", row.DailyPenaltyTotal)
	}
}

func TestCloseWeekAndMonthForTeam(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	now := time.Now().In(s.loc)
	thisWeekStart := startOfWeek(dateOnly(now, s.loc), s.loc)
	base := thisWeekStart.AddDate(0, 0, -6)
	teamID, userID := createTeamWithMember(t, s, "weekly@example.com", base)
	createTaskAt(t, s, teamID, api.Weekly, 5, 2, base)

	weekResA, err := s.CloseWeekForTeam(ctx, teamID)
	if err != nil {
		t.Fatalf("first CloseWeekForTeam failed: %v", err)
	}
	weekResB, err := s.CloseWeekForTeam(ctx, teamID)
	if err != nil {
		t.Fatalf("second CloseWeekForTeam failed: %v", err)
	}
	if weekResA.Month != weekResB.Month {
		t.Fatalf("expected same week close month, got %s and %s", weekResA.Month, weekResB.Month)
	}

	monthResTeam, err := s.CloseMonthForTeam(ctx, teamID)
	if err != nil {
		t.Fatalf("CloseMonthForTeam failed: %v", err)
	}
	monthResUser, err := s.CloseMonthForUser(ctx, userID)
	if err != nil {
		t.Fatalf("CloseMonthForUser failed: %v", err)
	}
	if monthResTeam.Month != monthResUser.Month {
		t.Fatalf("team/user close month mismatch: team=%s user=%s", monthResTeam.Month, monthResUser.Month)
	}

	row := getCurrentMonthSummary(t, s, teamID)
	if row.WeeklyPenaltyTotal != 5 {
		t.Fatalf("expected weekly penalty total=5, got %d", row.WeeklyPenaltyTotal)
	}
}

func TestCatchUpDayLockedProcessesMissingDays(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 12, 0, 0, 0, s.loc)

	teamID, _ := createTeamWithMember(t, s, "catchup-day@example.com", base)
	createTaskAt(t, s, teamID, api.Daily, 2, 1, base)

	if _, err := s.closeDayForTargetLocked(ctx, time.Date(2026, 1, 1, 0, 0, 0, 0, s.loc), teamID); err != nil {
		t.Fatalf("initial closeDayForTargetLocked failed: %v", err)
	}

	processed, err := s.catchUpDayLocked(ctx, time.Date(2026, 1, 5, 9, 0, 0, 0, s.loc), teamID)
	if err != nil {
		t.Fatalf("catchUpDayLocked failed: %v", err)
	}
	if processed != 3 {
		t.Fatalf("expected 3 processed days, got %d", processed)
	}

	jan := getMonthSummary(t, s, teamID, "2026-01")
	if jan.DailyPenaltyTotal != 8 {
		t.Fatalf("expected daily total=8 after catch-up, got %d", jan.DailyPenaltyTotal)
	}
}

func TestCatchUpDayLockedUsesTargetTimeTaskSnapshot(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 12, 0, 0, 0, s.loc)

	teamID, _ := createTeamWithMember(t, s, "snapshot-day@example.com", base)
	createTaskAt(t, s, teamID, api.Daily, 1, 1, time.Date(2026, 1, 1, 10, 0, 0, 0, s.loc))

	if _, err := s.closeDayForTargetLocked(ctx, time.Date(2026, 1, 1, 0, 0, 0, 0, s.loc), teamID); err != nil {
		t.Fatalf("initial closeDayForTargetLocked failed: %v", err)
	}

	// This task is created on 1/3 noon. It must not affect targetDate=1/2 (cutoff=1/3 00:00).
	createTaskAt(t, s, teamID, api.Daily, 1, 1, time.Date(2026, 1, 3, 12, 0, 0, 0, s.loc))

	processed, err := s.catchUpDayLocked(ctx, time.Date(2026, 1, 4, 9, 0, 0, 0, s.loc), teamID)
	if err != nil {
		t.Fatalf("catchUpDayLocked failed: %v", err)
	}
	if processed != 2 {
		t.Fatalf("expected 2 processed days, got %d", processed)
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

	teamID, _ := createTeamWithMember(t, s, "catchup-week@example.com", base)
	createTaskAt(t, s, teamID, api.Weekly, 3, 2, base)

	if _, err := s.closeWeekForTargetLocked(ctx, time.Date(2026, 1, 5, 0, 0, 0, 0, s.loc), teamID); err != nil {
		t.Fatalf("initial closeWeekForTargetLocked failed: %v", err)
	}

	processed, err := s.catchUpWeekLocked(ctx, time.Date(2026, 2, 4, 9, 0, 0, 0, s.loc), teamID)
	if err != nil {
		t.Fatalf("catchUpWeekLocked failed: %v", err)
	}
	if processed != 3 {
		t.Fatalf("expected 3 processed weeks, got %d", processed)
	}

	jan := getMonthSummary(t, s, teamID, "2026-01")
	if jan.WeeklyPenaltyTotal != 12 {
		t.Fatalf("expected weekly total=12 after catch-up, got %d", jan.WeeklyPenaltyTotal)
	}
}

func TestCatchUpMonthLockedProcessesMissingMonths(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	teamID, _ := createTeamWithMember(t, s, "catchup-month@example.com", time.Date(2025, 11, 15, 10, 0, 0, 0, s.loc))
	createTaskAt(t, s, teamID, api.Daily, 1, 1, time.Date(2025, 11, 15, 10, 0, 0, 0, s.loc))

	processed, lastMonth, err := s.catchUpMonthLocked(ctx, time.Date(2026, 2, 10, 9, 0, 0, 0, s.loc), teamID)
	if err != nil {
		t.Fatalf("catchUpMonthLocked failed: %v", err)
	}
	if processed != 3 {
		t.Fatalf("expected 3 processed months, got %d", processed)
	}
	if lastMonth != "2026-01" {
		t.Fatalf("expected lastMonth=2026-01, got %s", lastMonth)
	}

	for _, month := range []string{"2025-11", "2025-12", "2026-01"} {
		row := getMonthSummary(t, s, teamID, month)
		if !row.IsClosed {
			t.Fatalf("expected month %s to be closed", month)
		}
	}
}

func newTestStore(t *testing.T) *Store {
	t.Helper()
	t.Setenv("DATABASE_URL", dbtest.IsolatedDatabaseURL(t))
	t.Setenv("OIDC_STRICT_MODE", "false")
	t.Setenv("OIDC_ISSUER_URL", "")
	t.Setenv("OIDC_CLIENT_ID", "")
	t.Setenv("OIDC_CLIENT_SECRET", "")
	t.Setenv("OIDC_REDIRECT_URL", "")
	t.Setenv("SIGNUP_GUARD_ENABLED", "false")
	t.Setenv("SIGNUP_ALLOWED_EMAILS", "")
	s := NewStore()
	t.Cleanup(func() {
		if s.db != nil {
			s.db.Close()
		}
	})
	return s
}

func createTeamWithMember(t *testing.T, s *Store, email string, createdAt time.Time) (string, string) {
	t.Helper()
	ctx := context.Background()

	userID := s.nextID("user")
	teamID := s.nextID("team")
	if err := s.q.CreateUser(ctx, dbsqlc.CreateUserParams{
		ID:          userID,
		Email:       email,
		DisplayName: "Tester",
		CreatedAt:   toPgTimestamptz(createdAt),
	}); err != nil {
		t.Fatalf("failed to create user: %v", err)
	}
	if err := s.q.CreateTeam(ctx, dbsqlc.CreateTeamParams{
		ID:        teamID,
		Name:      "Team " + userID[:8],
		CreatedAt: toPgTimestamptz(createdAt),
	}); err != nil {
		t.Fatalf("failed to create team: %v", err)
	}
	if err := s.q.AddTeamMember(ctx, dbsqlc.AddTeamMemberParams{
		TeamID:    teamID,
		UserID:    userID,
		Role:      string(api.TeamMembershipRoleOwner),
		CreatedAt: toPgTimestamptz(createdAt),
	}); err != nil {
		t.Fatalf("failed to add team member: %v", err)
	}
	return teamID, userID
}

func createTask(t *testing.T, s *Store, teamID string, taskType api.TaskType, penalty, required int) {
	t.Helper()
	createTaskAt(t, s, teamID, taskType, penalty, required, time.Now().In(s.loc).Add(-24*time.Hour))
}

func createTaskAt(t *testing.T, s *Store, teamID string, taskType api.TaskType, penalty, required int, createdAt time.Time) {
	t.Helper()
	if err := s.q.CreateTask(context.Background(), dbsqlc.CreateTaskParams{
		ID:                         s.nextID("task"),
		TeamID:                     teamID,
		Title:                      "close target task",
		Notes:                      pgtype.Text{},
		Type:                       string(taskType),
		PenaltyPoints:              int32(penalty),
		Column7:                    "",
		RequiredCompletionsPerWeek: int32(required),
		CreatedAt:                  toPgTimestamptz(createdAt),
		UpdatedAt:                  toPgTimestamptz(createdAt),
	}); err != nil {
		t.Fatalf("failed to create task: %v", err)
	}
}

func getCurrentMonthSummary(t *testing.T, s *Store, teamID string) dbsqlc.MonthlyPenaltySummary {
	t.Helper()
	targetDate := dateOnly(time.Now().In(s.loc), s.loc).AddDate(0, 0, -1)
	month := monthKeyFromTime(targetDate, s.loc)
	monthStart, err := monthStartFromKey(month, s.loc)
	if err != nil {
		t.Fatalf("monthStartFromKey failed: %v", err)
	}
	row, err := s.q.GetMonthlyPenaltySummary(context.Background(), dbsqlc.GetMonthlyPenaltySummaryParams{
		TeamID:     teamID,
		MonthStart: toPgDate(monthStart),
	})
	if err != nil {
		t.Fatalf("GetMonthlyPenaltySummary failed: %v", err)
	}
	return row
}

func getMonthSummary(t *testing.T, s *Store, teamID, month string) dbsqlc.MonthlyPenaltySummary {
	t.Helper()
	monthStart, err := monthStartFromKey(month, s.loc)
	if err != nil {
		t.Fatalf("monthStartFromKey failed: %v", err)
	}
	row, err := s.q.GetMonthlyPenaltySummary(context.Background(), dbsqlc.GetMonthlyPenaltySummaryParams{
		TeamID:     teamID,
		MonthStart: toPgDate(monthStart),
	})
	if err != nil {
		t.Fatalf("GetMonthlyPenaltySummary failed: %v", err)
	}
	return row
}
