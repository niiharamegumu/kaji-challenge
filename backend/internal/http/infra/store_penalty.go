package infra

import (
	"context"
	"errors"
	"strings"
	"time"

	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (s *store) listPenaltyRules(ctx context.Context, userID string) ([]api.PenaltyRule, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListPenaltyRulesByTeamID(ctx, teamID)
	if err != nil {
		return nil, err
	}
	items := []api.PenaltyRule{}
	for _, row := range rows {
		items = append(items, ruleFromDB(row, s.loc).toAPI())
	}
	return items, nil
}

func (s *store) createPenaltyRule(ctx context.Context, userID string, req api.CreatePenaltyRuleRequest) (api.PenaltyRule, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.PenaltyRule{}, err
	}
	now := time.Now().In(s.loc)
	active := true
	if req.IsActive != nil {
		active = *req.IsActive
	}
	r := ruleRecord{
		ID:          s.nextID("pr"),
		TeamID:      teamID,
		Threshold:   req.Threshold,
		Name:        req.Name,
		Description: req.Description,
		IsActive:    active,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	threshold32, err := safeInt32(r.Threshold, "threshold")
	if err != nil {
		return api.PenaltyRule{}, err
	}
	if err := s.q.CreatePenaltyRule(ctx, dbsqlc.CreatePenaltyRuleParams{
		ID:          r.ID,
		TeamID:      r.TeamID,
		Threshold:   threshold32,
		Name:        r.Name,
		Description: textFromPtr(r.Description),
		IsActive:    r.IsActive,
		CreatedAt:   toPgTimestamptz(r.CreatedAt),
		UpdatedAt:   toPgTimestamptz(r.UpdatedAt),
	}); err != nil {
		return api.PenaltyRule{}, err
	}
	return r.toAPI(), nil
}

func (s *store) patchPenaltyRule(ctx context.Context, userID, ruleID string, req api.UpdatePenaltyRuleRequest) (api.PenaltyRule, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.PenaltyRule{}, err
	}
	row, err := s.q.GetPenaltyRuleByID(ctx, ruleID)
	if err != nil {
		return api.PenaltyRule{}, errors.New("rule not found")
	}
	rule := ruleFromDB(row, s.loc)
	if rule.TeamID != teamID {
		return api.PenaltyRule{}, errors.New("rule not found")
	}
	if req.Threshold != nil {
		rule.Threshold = *req.Threshold
	}
	if req.Name != nil {
		rule.Name = strings.TrimSpace(*req.Name)
	}
	if req.Description != nil {
		rule.Description = req.Description
	}
	if req.IsActive != nil {
		rule.IsActive = *req.IsActive
	}
	rule.UpdatedAt = time.Now().In(s.loc)
	threshold32, err := safeInt32(rule.Threshold, "threshold")
	if err != nil {
		return api.PenaltyRule{}, err
	}
	if err := s.q.UpdatePenaltyRule(ctx, dbsqlc.UpdatePenaltyRuleParams{
		ID:          rule.ID,
		Threshold:   threshold32,
		Name:        rule.Name,
		Description: textFromPtr(rule.Description),
		IsActive:    rule.IsActive,
		UpdatedAt:   toPgTimestamptz(rule.UpdatedAt),
	}); err != nil {
		return api.PenaltyRule{}, err
	}
	return rule.toAPI(), nil
}

func (s *store) deletePenaltyRule(ctx context.Context, userID, ruleID string) error {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return err
	}
	rule, err := s.q.GetPenaltyRuleByID(ctx, ruleID)
	if err != nil || rule.TeamID != teamID {
		return errors.New("rule not found")
	}
	return s.q.DeletePenaltyRule(ctx, ruleID)
}
