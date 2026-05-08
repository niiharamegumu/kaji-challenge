package repositories

import (
	"context"

	model "github.com/megu/kaji-challenge/backend/internal/http/application/model"
)

func (r penaltyRepo) ListPenaltyRules(ctx context.Context, userID string, includeDeleted bool) ([]model.PenaltyRule, error) {
	items, err := r.store.ListPenaltyRules(ctx, userID, includeDeleted)
	return items, mapInfraErr(err)
}

func (r penaltyRepo) CreatePenaltyRule(ctx context.Context, userID string, req model.CreatePenaltyRuleRequest) (model.PenaltyRule, error) {
	res, err := r.store.CreatePenaltyRule(ctx, userID, req)
	return res, mapInfraErr(err)
}

func (r penaltyRepo) PatchPenaltyRule(ctx context.Context, userID, ruleID string, req model.UpdatePenaltyRuleRequest) (model.PenaltyRule, error) {
	res, err := r.store.PatchPenaltyRule(ctx, userID, ruleID, req)
	return res, mapInfraErr(err)
}

func (r penaltyRepo) DeletePenaltyRule(ctx context.Context, userID, ruleID string) error {
	return mapInfraErr(r.store.DeletePenaltyRule(ctx, userID, ruleID))
}
