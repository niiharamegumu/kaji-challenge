package store

import (
	"context"
	"testing"
	"time"

	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func TestCreateTaskAppendsWithinType(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	base := time.Date(2026, 3, 1, 9, 0, 0, 0, s.loc)
	_, userID := createTeamWithMember(t, s, "task-create@example.com", base)

	firstDaily, err := s.CreateTask(withLatestIfMatchForUser(t, s, ctx, userID), userID, api.CreateTaskRequest{
		Title:         "皿洗い",
		Type:          api.TaskTypeDaily,
		PenaltyPoints: 1,
	})
	if err != nil {
		t.Fatalf("CreateTask daily failed: %v", err)
	}
	firstWeekly, err := s.CreateTask(withLatestIfMatchForUser(t, s, ctx, userID), userID, api.CreateTaskRequest{
		Title:                      "風呂掃除",
		Type:                       api.TaskTypeWeekly,
		PenaltyPoints:              2,
		RequiredCompletionsPerWeek: intPtr(2),
	})
	if err != nil {
		t.Fatalf("CreateTask weekly failed: %v", err)
	}
	secondDaily, err := s.CreateTask(withLatestIfMatchForUser(t, s, ctx, userID), userID, api.CreateTaskRequest{
		Title:         "洗濯",
		Type:          api.TaskTypeDaily,
		PenaltyPoints: 3,
	})
	if err != nil {
		t.Fatalf("CreateTask second daily failed: %v", err)
	}

	if firstDaily.SortKey != int(sortKeyStep) || firstWeekly.SortKey != int(sortKeyStep) || secondDaily.SortKey != int(sortKeyStep*2) {
		t.Fatalf("unexpected sort keys: daily1=%d weekly1=%d daily2=%d", firstDaily.SortKey, firstWeekly.SortKey, secondDaily.SortKey)
	}
}

func TestListTasksOrdersByTypeAndPosition(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	base := time.Date(2026, 3, 1, 9, 0, 0, 0, s.loc)
	_, userID := createTeamWithMember(t, s, "task-list@example.com", base)

	weeklyID := createTaskWithIDAt(t, s, teamIDForUser(t, s, userID), api.TaskTypeWeekly, 3, 2, base)
	firstDailyID := createTaskWithIDAt(t, s, teamIDForUser(t, s, userID), api.TaskTypeDaily, 1, 1, base.Add(time.Minute))
	secondDailyID := createTaskWithIDAt(t, s, teamIDForUser(t, s, userID), api.TaskTypeDaily, 2, 1, base.Add(2*time.Minute))

	items, err := s.ListTasks(ctx, userID, nil)
	if err != nil {
		t.Fatalf("ListTasks failed: %v", err)
	}
	if len(items) != 3 {
		t.Fatalf("expected 3 tasks, got %d", len(items))
	}
	if items[0].Id != firstDailyID || items[0].SortKey != int(sortKeyStep) {
		t.Fatalf("unexpected first task: %#v", items[0])
	}
	if items[1].Id != secondDailyID || items[1].SortKey != int(sortKeyStep*2) {
		t.Fatalf("unexpected second task: %#v", items[1])
	}
	if items[2].Id != weeklyID || items[2].SortKey != int(sortKeyStep) {
		t.Fatalf("unexpected third task: %#v", items[2])
	}
}

func TestDeleteTaskKeepsExistingSortKeysWithinType(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	base := time.Date(2026, 3, 1, 9, 0, 0, 0, s.loc)
	_, userID := createTeamWithMember(t, s, "task-delete@example.com", base)
	teamID := teamIDForUser(t, s, userID)

	firstDailyID := createTaskWithIDAt(t, s, teamID, api.TaskTypeDaily, 1, 1, base)
	secondDailyID := createTaskWithIDAt(t, s, teamID, api.TaskTypeDaily, 2, 1, base.Add(time.Minute))
	thirdDailyID := createTaskWithIDAt(t, s, teamID, api.TaskTypeDaily, 3, 1, base.Add(2*time.Minute))

	if err := s.DeleteTask(withLatestIfMatchForUser(t, s, ctx, userID), userID, secondDailyID); err != nil {
		t.Fatalf("DeleteTask failed: %v", err)
	}

	items, err := s.ListTasks(ctx, userID, nil)
	if err != nil {
		t.Fatalf("ListTasks failed: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 tasks, got %d", len(items))
	}
	if items[0].Id != firstDailyID || items[0].SortKey != int(sortKeyStep) {
		t.Fatalf("unexpected first task after delete: %#v", items[0])
	}
	if items[1].Id != thirdDailyID || items[1].SortKey != int(sortKeyStep*3) {
		t.Fatalf("unexpected second task after delete: %#v", items[1])
	}
}

func TestReorderTasksPersistsRequestedOrderWithinType(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	base := time.Date(2026, 3, 1, 9, 0, 0, 0, s.loc)
	_, userID := createTeamWithMember(t, s, "task-reorder@example.com", base)
	teamID := teamIDForUser(t, s, userID)

	firstID := createTaskWithIDAt(t, s, teamID, api.TaskTypeDaily, 1, 1, base)
	secondID := createTaskWithIDAt(t, s, teamID, api.TaskTypeDaily, 2, 1, base.Add(time.Minute))
	thirdID := createTaskWithIDAt(t, s, teamID, api.TaskTypeDaily, 3, 1, base.Add(2*time.Minute))
	createTaskWithIDAt(t, s, teamID, api.TaskTypeWeekly, 2, 2, base.Add(3*time.Minute))

	items, err := s.ReorderTasks(withLatestIfMatchForUser(t, s, ctx, userID), userID, api.ReorderTasksRequest{
		TaskIds: []string{thirdID, firstID, secondID},
	})
	if err != nil {
		t.Fatalf("ReorderTasks failed: %v", err)
	}
	if len(items) != 3 {
		t.Fatalf("expected 3 reordered tasks, got %d", len(items))
	}
	if items[0].Id != thirdID || items[0].SortKey >= items[1].SortKey {
		t.Fatalf("unexpected first task after reorder: %#v", items[0])
	}
	if items[1].Id != firstID || items[2].Id != secondID {
		t.Fatalf("unexpected reordered sequence: %#v", items)
	}
}

func TestReorderTasksHandlesNonContiguousPositions(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	base := time.Date(2026, 3, 1, 9, 0, 0, 0, s.loc)
	_, userID := createTeamWithMember(t, s, "task-reorder-gapped@example.com", base)
	teamID := teamIDForUser(t, s, userID)

	firstID := createTaskWithIDAt(t, s, teamID, api.TaskTypeDaily, 1, 1, base)
	secondID := createTaskWithIDAt(t, s, teamID, api.TaskTypeDaily, 2, 1, base.Add(time.Minute))
	thirdID := createTaskWithIDAt(t, s, teamID, api.TaskTypeDaily, 3, 1, base.Add(2*time.Minute))

	if err := s.q.DeleteTask(ctx, secondID); err != nil {
		t.Fatalf("failed to create gapped positions: %v", err)
	}

	items, err := s.ReorderTasks(withLatestIfMatchForUser(t, s, ctx, userID), userID, api.ReorderTasksRequest{
		TaskIds: []string{thirdID, firstID},
	})
	if err != nil {
		t.Fatalf("ReorderTasks with gapped positions failed: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 reordered tasks, got %d", len(items))
	}
	if items[0].Id != thirdID || items[0].SortKey >= items[1].SortKey {
		t.Fatalf("unexpected first task after reorder with gaps: %#v", items[0])
	}
	if items[1].Id != firstID || items[1].SortKey <= items[0].SortKey {
		t.Fatalf("unexpected second task after reorder with gaps: %#v", items[1])
	}
}

func TestReorderTasksRejectsMismatchedTypeAndIDs(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	base := time.Date(2026, 3, 1, 9, 0, 0, 0, s.loc)
	_, userID := createTeamWithMember(t, s, "task-reorder-invalid@example.com", base)
	teamID := teamIDForUser(t, s, userID)

	firstDailyID := createTaskWithIDAt(t, s, teamID, api.TaskTypeDaily, 1, 1, base)
	secondDailyID := createTaskWithIDAt(t, s, teamID, api.TaskTypeDaily, 2, 1, base.Add(time.Minute))
	weeklyID := createTaskWithIDAt(t, s, teamID, api.TaskTypeWeekly, 3, 2, base.Add(2*time.Minute))

	if _, err := s.ReorderTasks(withLatestIfMatchForUser(t, s, ctx, userID), userID, api.ReorderTasksRequest{
		TaskIds: []string{firstDailyID, weeklyID},
	}); err == nil {
		t.Fatalf("expected ReorderTasks to reject mixed task types")
	}
	if _, err := s.ReorderTasks(withLatestIfMatchForUser(t, s, ctx, userID), userID, api.ReorderTasksRequest{
		TaskIds: []string{firstDailyID, secondDailyID, secondDailyID},
	}); err == nil {
		t.Fatalf("expected ReorderTasks to reject duplicate ids")
	}
	if _, err := s.ReorderTasks(withLatestIfMatchForUser(t, s, ctx, userID), userID, api.ReorderTasksRequest{
		TaskIds: []string{"missing-id"},
	}); err == nil {
		t.Fatalf("expected ReorderTasks to reject mismatched ids")
	}
}

func teamIDForUser(t *testing.T, s *Store, userID string) string {
	t.Helper()
	teamID, err := s.primaryTeamLocked(context.Background(), userID)
	if err != nil {
		t.Fatalf("failed to load team: %v", err)
	}
	return teamID
}

func intPtr(value int) *int {
	return &value
}
