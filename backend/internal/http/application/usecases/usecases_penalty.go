package usecases

import (
	"context"

	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (u penaltyUsecase) ListPenaltyRules(ctx context.Context, userID string, includeDeleted bool) ([]api.PenaltyRule, error) {
	return u.repo.ListPenaltyRules(ctx, userID, includeDeleted)
}

func (u penaltyUsecase) CreatePenaltyRule(ctx context.Context, userID string, req api.CreatePenaltyRuleRequest) (api.PenaltyRule, error) {
	return u.repo.CreatePenaltyRule(ctx, userID, req)
}

func (u penaltyUsecase) PatchPenaltyRule(ctx context.Context, userID, ruleID string, req api.UpdatePenaltyRuleRequest) (api.PenaltyRule, error) {
	return u.repo.PatchPenaltyRule(ctx, userID, ruleID, req)
}

func (u penaltyUsecase) DeletePenaltyRule(ctx context.Context, userID, ruleID string) error {
	return u.repo.DeletePenaltyRule(ctx, userID, ruleID)
}
