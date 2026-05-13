package store

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	"github.com/megu/kaji-challenge/backend/internal/testutil/dbtest"
)

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
		Role:      string(model.TeamMembershipRoleOwner),
		CreatedAt: toPgTimestamptz(createdAt),
	}); err != nil {
		t.Fatalf("failed to add team member: %v", err)
	}
	return teamID, userID
}

func createTask(t *testing.T, s *Store, teamID string, taskType model.TaskType, penalty, required int) {
	t.Helper()
	createTaskAt(t, s, teamID, taskType, penalty, required, time.Now().In(s.loc).Add(-24*time.Hour))
}

func createTaskAt(t *testing.T, s *Store, teamID string, taskType model.TaskType, penalty, required int, createdAt time.Time) {
	t.Helper()
	_ = createTaskWithIDAt(t, s, teamID, taskType, penalty, required, createdAt)
}

func createTaskWithIDAt(t *testing.T, s *Store, teamID string, taskType model.TaskType, penalty, required int, createdAt time.Time) string {
	t.Helper()
	taskID := s.nextID("task")
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
		Title:                      "close target task",
		Notes:                      pgtype.Text{},
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
