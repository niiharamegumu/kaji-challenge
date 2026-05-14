package store

import (
	"context"
	"testing"
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
)

func TestPenaltyRuleLifecycle(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	_, userID := createTeamWithMember(t, s, "penalty-lifecycle@example.com", time.Now().In(s.loc))
	description := "first description"

	created, err := s.CreatePenaltyRule(withLatestIfMatchForUser(t, s, ctx, userID), userID, model.CreatePenaltyRuleRequest{
		Name:        "  First rule  ",
		Threshold:   3,
		Description: &description,
	})
	if err != nil {
		t.Fatalf("CreatePenaltyRule failed: %v", err)
	}
	if created.Name != "  First rule  " || created.Threshold != 3 || created.Description == nil || *created.Description != description {
		t.Fatalf("unexpected created rule: %+v", created)
	}

	name := "  Updated rule  "
	threshold := 5
	updated, err := s.PatchPenaltyRule(withLatestIfMatchForUser(t, s, ctx, userID), userID, created.Id, model.UpdatePenaltyRuleRequest{
		Name:      &name,
		Threshold: &threshold,
	})
	if err != nil {
		t.Fatalf("PatchPenaltyRule failed: %v", err)
	}
	if updated.Name != "Updated rule" || updated.Threshold != 5 {
		t.Fatalf("unexpected updated rule: %+v", updated)
	}

	if err := s.DeletePenaltyRule(withLatestIfMatchForUser(t, s, ctx, userID), userID, created.Id); err != nil {
		t.Fatalf("DeletePenaltyRule failed: %v", err)
	}

	active, err := s.ListPenaltyRules(ctx, userID, false)
	if err != nil {
		t.Fatalf("ListPenaltyRules active failed: %v", err)
	}
	if len(active) != 0 {
		t.Fatalf("expected deleted rule to be hidden, got %+v", active)
	}

	all, err := s.ListPenaltyRules(ctx, userID, true)
	if err != nil {
		t.Fatalf("ListPenaltyRules all failed: %v", err)
	}
	if len(all) != 1 || all[0].DeletedAt == nil {
		t.Fatalf("expected soft-deleted rule in includeDeleted list, got %+v", all)
	}
}

func TestPenaltyRuleRejectsWrongTeamAndMissingIfMatch(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	teamID, ownerID := createTeamWithMember(t, s, "penalty-owner@example.com", time.Now().In(s.loc))
	_, otherID := createTeamWithMember(t, s, "penalty-other@example.com", time.Now().In(s.loc))
	ruleID := createPenaltyRuleAt(t, s, teamID, 2, "team rule", time.Now().In(s.loc))

	if _, err := s.PatchPenaltyRule(ctx, ownerID, ruleID, model.UpdatePenaltyRuleRequest{}); err == nil {
		t.Fatal("expected missing If-Match to fail")
	}
	if err := s.DeletePenaltyRule(withLatestIfMatchForUser(t, s, ctx, otherID), otherID, ruleID); err == nil {
		t.Fatal("expected deleting another team's rule to fail")
	}
}
