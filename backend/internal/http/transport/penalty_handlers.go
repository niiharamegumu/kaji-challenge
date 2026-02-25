package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (h *Handler) ListPenaltyRules(c *gin.Context, params api.ListPenaltyRulesParams) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	includeDeleted := false
	if params.IncludeDeleted != nil {
		includeDeleted = *params.IncludeDeleted
	}
	items, err := h.services.Penalty.ListPenaltyRules(c.Request.Context(), userID, includeDeleted)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	h.writeTeamETag(c, userID)
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) PostPenaltyRule(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	req, ok := bindJSON[api.CreatePenaltyRuleRequest](c)
	if !ok {
		return
	}
	rule, err := h.services.Penalty.CreatePenaltyRule(c.Request.Context(), userID, req)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusCreated, rule)
}

func (h *Handler) PatchPenaltyRule(c *gin.Context, ruleID string) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	req, ok := bindJSON[api.UpdatePenaltyRuleRequest](c)
	if !ok {
		return
	}
	rule, err := h.services.Penalty.PatchPenaltyRule(c.Request.Context(), userID, ruleID, req)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, rule)
}

func (h *Handler) DeletePenaltyRule(c *gin.Context, ruleID string) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	if err := h.services.Penalty.DeletePenaltyRule(c.Request.Context(), userID, ruleID); err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.Status(http.StatusNoContent)
}
