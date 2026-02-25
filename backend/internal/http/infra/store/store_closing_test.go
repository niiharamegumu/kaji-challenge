package store

import (
	"context"
	"errors"
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
	monthResUser, err := s.CloseMonthForUser(withLatestIfMatchForUser(t, s, ctx, userID), userID)
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
	return NewIfMatchContext(ctx, etagFromRevision(teamID, revision))
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
	createTaskAt(t, s, teamID, api.Weekly, 4, 1, createdAt)

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
	apiSummary, err := s.GetMonthlySummary(ctx, userID, &targetMonth)
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
	createTaskAt(t, s, teamID, api.Daily, 2, 1, createdAt)

	if _, _, err := s.closeMonthForTargetLocked(ctx, time.Date(2025, 12, 1, 0, 0, 0, 0, s.loc), teamID); err != nil {
		t.Fatalf("closeMonthForTargetLocked failed: %v", err)
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
	createTaskAt(t, s, teamID, api.Weekly, 3, 1, createdAt)

	if _, _, err := s.closeMonthForTargetLocked(ctx, time.Date(2026, 1, 1, 0, 0, 0, 0, s.loc), teamID); err != nil {
		t.Fatalf("closeMonthForTargetLocked failed: %v", err)
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

func TestCloseMonthForTargetLockedUsesRuleSnapshotAtMonthEnd(t *testing.T) {
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

	didRun, gotMonth, err := s.closeMonthForTargetLocked(ctx, monthStart, teamID)
	if err != nil {
		t.Fatalf("closeMonthForTargetLocked failed: %v", err)
	}
	if !didRun {
		t.Fatalf("expected closeMonthForTargetLocked to run")
	}
	if gotMonth != "2026-01" {
		t.Fatalf("expected month 2026-01, got %s", gotMonth)
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
	summary, err := s.GetMonthlySummary(ctx, userID, &targetMonth)
	if err != nil {
		t.Fatalf("GetMonthlySummary failed: %v", err)
	}

	if len(summary.TriggeredPenaltyRuleIds) != 1 || summary.TriggeredPenaltyRuleIds[0] != ruleDeletedAfterMonthEnd {
		t.Fatalf("expected only rule effective at month end to trigger, got %v", summary.TriggeredPenaltyRuleIds)
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

func createPenaltyRuleAt(t *testing.T, s *Store, teamID string, threshold int, name string, createdAt time.Time) string {
	t.Helper()
	ruleID := s.nextID("pr")
	if err := s.q.CreatePenaltyRule(context.Background(), dbsqlc.CreatePenaltyRuleParams{
		ID:          ruleID,
		TeamID:      teamID,
		Threshold:   int32(threshold),
		Name:        name,
		Description: pgtype.Text{},
		CreatedAt:   toPgTimestamptz(createdAt),
		UpdatedAt:   toPgTimestamptz(createdAt),
	}); err != nil {
		t.Fatalf("failed to create penalty rule: %v", err)
	}
	return ruleID
}

func softDeletePenaltyRuleAt(t *testing.T, s *Store, ruleID string, deletedAt time.Time) {
	t.Helper()
	rows, err := s.q.SoftDeletePenaltyRule(context.Background(), dbsqlc.SoftDeletePenaltyRuleParams{
		ID:        ruleID,
		DeletedAt: toPgTimestamptz(deletedAt),
	})
	if err != nil {
		t.Fatalf("failed to soft-delete penalty rule: %v", err)
	}
	if rows != 1 {
		t.Fatalf("expected one soft-deleted rule, got %d", rows)
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
