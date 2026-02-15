package http

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

type Handler struct {
	store *store
}

func (h *Handler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, api.HealthResponse{Status: "ok"})
}

func (h *Handler) GetAuthGoogleStart(c *gin.Context) {
	res, err := h.store.startGoogleAuth(c.Request.Context())
	if err != nil {
		writeError(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetAuthGoogleCallback(c *gin.Context, params api.GetAuthGoogleCallbackParams) {
	exchangeCode, redirectTo, err := h.store.completeGoogleAuth(c.Request.Context(), params.Code, params.State, c.Query("mock_email"), c.Query("mock_name"), c.Query("mock_sub"))
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	if redirectTo != "" {
		sep := "?"
		if strings.Contains(redirectTo, "?") {
			sep = "&"
		}
		c.Redirect(http.StatusFound, redirectTo+sep+"exchangeCode="+url.QueryEscape(exchangeCode))
		return
	}
	c.JSON(http.StatusOK, api.AuthCallbackResponse{ExchangeCode: exchangeCode})
}

func (h *Handler) PostAuthSessionsExchange(c *gin.Context) {
	var req api.AuthSessionExchangeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "invalid request body")
		return
	}
	session, err := h.store.exchangeSession(c.Request.Context(), req.ExchangeCode)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, session)
}

func (h *Handler) PostAuthLogout(c *gin.Context) {
	token := c.GetString(authTokenKey)
	if token == "" {
		writeError(c, http.StatusUnauthorized, "missing bearer token")
		return
	}
	h.store.revokeSession(c.Request.Context(), token)
	c.Status(http.StatusNoContent)
}

func (h *Handler) GetMe(c *gin.Context) {
	user, memberships, err := h.store.currentUserAndMemberships(c.Request.Context(), c.GetString(authUserIDKey))
	if err != nil {
		writeError(c, http.StatusUnauthorized, err.Error())
		return
	}
	c.JSON(http.StatusOK, api.MeResponse{User: user.toAPI(), Memberships: memberships})
}

func (h *Handler) PostTeamInvite(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	var req api.CreateInviteRequest
	if c.Request.ContentLength > 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			writeError(c, http.StatusBadRequest, "invalid request body")
			return
		}
	}

	invite, err := h.store.createInvite(c.Request.Context(), userID, req)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusCreated, invite)
}

func (h *Handler) PostTeamJoin(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	var req api.JoinTeamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "invalid request body")
		return
	}

	res, err := h.store.joinTeam(c.Request.Context(), userID, req.Code)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListTasks(c *gin.Context, params api.ListTasksParams) {
	userID := c.GetString(authUserIDKey)
	items, err := h.store.listTasks(c.Request.Context(), userID, params.Type)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) PostTask(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	var req api.CreateTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "invalid request body")
		return
	}

	task, err := h.store.createTask(c.Request.Context(), userID, req)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusCreated, task)
}

func (h *Handler) PatchTask(c *gin.Context, taskID string) {
	userID := c.GetString(authUserIDKey)
	var req api.UpdateTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "invalid request body")
		return
	}
	task, err := h.store.patchTask(c.Request.Context(), userID, taskID, req)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, task)
}

func (h *Handler) DeleteTask(c *gin.Context, taskID string) {
	userID := c.GetString(authUserIDKey)
	if err := h.store.deleteTask(c.Request.Context(), userID, taskID); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) PostTaskCompletionToggle(c *gin.Context, taskID string) {
	userID := c.GetString(authUserIDKey)
	var req api.ToggleTaskCompletionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "invalid request body")
		return
	}

	res, err := h.store.toggleTaskCompletion(c.Request.Context(), userID, taskID, req.TargetDate.Time)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListPenaltyRules(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	items, err := h.store.listPenaltyRules(c.Request.Context(), userID)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) PostPenaltyRule(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	var req api.CreatePenaltyRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "invalid request body")
		return
	}

	rule, err := h.store.createPenaltyRule(c.Request.Context(), userID, req)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusCreated, rule)
}

func (h *Handler) PatchPenaltyRule(c *gin.Context, ruleID string) {
	userID := c.GetString(authUserIDKey)
	var req api.UpdatePenaltyRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "invalid request body")
		return
	}
	rule, err := h.store.patchPenaltyRule(c.Request.Context(), userID, ruleID, req)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, rule)
}

func (h *Handler) DeletePenaltyRule(c *gin.Context, ruleID string) {
	userID := c.GetString(authUserIDKey)
	if err := h.store.deletePenaltyRule(c.Request.Context(), userID, ruleID); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) GetHome(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	home, err := h.store.getHome(c.Request.Context(), userID)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, home)
}

func (h *Handler) GetPenaltySummaryMonthly(c *gin.Context, params api.GetPenaltySummaryMonthlyParams) {
	userID := c.GetString(authUserIDKey)
	summary, err := h.store.getMonthlySummary(c.Request.Context(), userID, params.Month)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, summary)
}

func (h *Handler) PostAdminCloseDay(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	res, err := h.store.closeDayForUser(c.Request.Context(), userID)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) PostAdminCloseWeek(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	res, err := h.store.closeWeekForUser(c.Request.Context(), userID)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) PostAdminCloseMonth(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	res, err := h.store.closeMonthForUser(c.Request.Context(), userID)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, res)
}

func writeError(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{"message": message})
}
