package store

import (
	"context"
	"errors"
	"strings"
	"time"

	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (s *Store) ListPenaltyRules(ctx context.Context, userID string, includeDeleted bool) ([]api.PenaltyRule, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return nil, err
	}
	var rows []dbsqlc.PenaltyRule
	if includeDeleted {
		rows, err = s.q.ListPenaltyRulesByTeamID(ctx, teamID)
	} else {
		rows, err = s.q.ListUndeletedPenaltyRulesByTeamID(ctx, teamID)
	}
	if err != nil {
		return nil, err
	}
	items := []api.PenaltyRule{}
	for _, row := range rows {
		items = append(items, ruleFromDB(row, s.loc).toAPI())
	}
	return items, nil
}

func (s *Store) CreatePenaltyRule(ctx context.Context, userID string, req api.CreatePenaltyRuleRequest) (api.PenaltyRule, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.PenaltyRule{}, err
	}
	now := time.Now().In(s.loc)
	r := ruleRecord{
		ID:          s.nextID("pr"),
		TeamID:      teamID,
		Threshold:   req.Threshold,
		Name:        req.Name,
		Description: req.Description,
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
		CreatedAt:   toPgTimestamptz(r.CreatedAt),
		UpdatedAt:   toPgTimestamptz(r.UpdatedAt),
	}); err != nil {
		return api.PenaltyRule{}, err
	}
	return r.toAPI(), nil
}

func (s *Store) PatchPenaltyRule(ctx context.Context, userID, ruleID string, req api.UpdatePenaltyRuleRequest) (api.PenaltyRule, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.PenaltyRule{}, err
	}
	row, err := s.q.GetUndeletedPenaltyRuleByID(ctx, ruleID)
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
		UpdatedAt:   toPgTimestamptz(rule.UpdatedAt),
	}); err != nil {
		return api.PenaltyRule{}, err
	}
	return rule.toAPI(), nil
}

func (s *Store) DeletePenaltyRule(ctx context.Context, userID, ruleID string) error {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return err
	}
	rule, err := s.q.GetUndeletedPenaltyRuleByID(ctx, ruleID)
	if err != nil || rule.TeamID != teamID {
		return errors.New("rule not found")
	}
	now := time.Now().In(s.loc)
	rows, err := s.q.SoftDeletePenaltyRule(ctx, dbsqlc.SoftDeletePenaltyRuleParams{
		ID:        ruleID,
		DeletedAt: toPgTimestamptz(now),
	})
	if err != nil {
		return err
	}
	if rows == 0 {
		return errors.New("rule not found")
	}
	return nil
}
