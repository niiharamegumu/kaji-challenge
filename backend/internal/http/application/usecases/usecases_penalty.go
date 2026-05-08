package usecases

import (
	"context"

	model "github.com/megu/kaji-challenge/backend/internal/http/application/model"
)

func (u penaltyUsecase) ListPenaltyRules(ctx context.Context, userID string, includeDeleted bool) ([]model.PenaltyRule, error) {
	return u.repo.ListPenaltyRules(ctx, userID, includeDeleted)
}

func (u penaltyUsecase) CreatePenaltyRule(ctx context.Context, userID string, req model.CreatePenaltyRuleRequest) (model.PenaltyRule, error) {
	return u.repo.CreatePenaltyRule(ctx, userID, req)
}

func (u penaltyUsecase) PatchPenaltyRule(ctx context.Context, userID, ruleID string, req model.UpdatePenaltyRuleRequest) (model.PenaltyRule, error) {
	return u.repo.PatchPenaltyRule(ctx, userID, ruleID, req)
}

func (u penaltyUsecase) DeletePenaltyRule(ctx context.Context, userID, ruleID string) error {
	return u.repo.DeletePenaltyRule(ctx, userID, ruleID)
}
