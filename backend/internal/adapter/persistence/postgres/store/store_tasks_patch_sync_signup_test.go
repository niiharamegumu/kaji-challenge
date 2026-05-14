package store

import (
	"context"
	"strings"
	"testing"
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
)

func TestPatchTaskUpdatesFieldsAndTeamETag(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	teamID, userID := createTeamWithMember(t, s, "patch-task@example.com", time.Now().In(s.loc))
	taskID := createTaskWithIDAt(t, s, teamID, model.TaskTypeWeekly, 2, 2, time.Now().In(s.loc).Add(-24*time.Hour))

	beforeETag, err := s.TeamETagForUser(ctx, userID)
	if err != nil {
		t.Fatalf("TeamETagForUser before failed: %v", err)
	}
	title := "  Patched weekly  "
	notes := "updated notes"
	penalty := 9
	required := 3
	updated, err := s.PatchTask(withLatestIfMatchForUser(t, s, ctx, userID), userID, taskID, model.UpdateTaskRequest{
		Title:                      &title,
		Notes:                      &notes,
		PenaltyPoints:              &penalty,
		RequiredCompletionsPerWeek: &required,
	})
	if err != nil {
		t.Fatalf("PatchTask failed: %v", err)
	}
	if updated.Title != "Patched weekly" || updated.Notes == nil || *updated.Notes != notes || updated.PenaltyPoints != penalty || updated.RequiredCompletionsPerWeek != required {
		t.Fatalf("unexpected patched task: %+v", updated)
	}

	afterETag, err := s.TeamETagForUser(ctx, userID)
	if err != nil {
		t.Fatalf("TeamETagForUser after failed: %v", err)
	}
	if beforeETag == afterETag || !strings.HasPrefix(afterETag, `W/"team:`) {
		t.Fatalf("expected bumped weak ETag, before=%q after=%q", beforeETag, afterETag)
	}
}

func TestToggleTaskCompletionRejectsDailyFutureAndWeeklyOutsideCurrentWeek(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 3, 11, 9, 0, 0, 0, s.loc)
	s.now = func() time.Time { return now }
	teamID, userID := createTeamWithMember(t, s, "toggle-boundary@example.com", now.Add(-48*time.Hour))
	dailyID := createTaskWithIDAt(t, s, teamID, model.TaskTypeDaily, 1, 1, now.Add(-48*time.Hour))
	weeklyID := createTaskWithIDAt(t, s, teamID, model.TaskTypeWeekly, 1, 2, now.Add(-48*time.Hour))

	action := model.Toggle
	if _, err := s.ToggleTaskCompletion(withLatestIfMatchForUser(t, s, ctx, userID), userID, dailyID, now.AddDate(0, 0, 1), &action); err == nil {
		t.Fatal("expected future daily completion to fail")
	}
	if _, err := s.ToggleTaskCompletion(withLatestIfMatchForUser(t, s, ctx, userID), userID, weeklyID, now.AddDate(0, 0, 8), &action); err == nil {
		t.Fatal("expected weekly completion outside current week to fail")
	}
}
