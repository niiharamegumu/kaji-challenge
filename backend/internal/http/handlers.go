package http

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

type Handler struct {
	services *services
}

func (h *Handler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, api.HealthResponse{Status: "ok"})
}

func (h *Handler) GetAuthGoogleStart(c *gin.Context) {
	res, err := h.services.auth.StartGoogleAuth(c.Request.Context())
	if err != nil {
		writeAppError(c, err, http.StatusInternalServerError)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetAuthGoogleCallback(c *gin.Context, params api.GetAuthGoogleCallbackParams) {
	exchangeCode, redirectTo, err := h.services.auth.CompleteGoogleAuth(c.Request.Context(), params.Code, params.State, c.Query("mock_email"), c.Query("mock_name"), c.Query("mock_sub"))
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
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
		writeAppError(c, newAppError(http.StatusBadRequest, "invalid_request", "invalid request body"), http.StatusBadRequest)
		return
	}
	session, err := h.services.auth.ExchangeSession(c.Request.Context(), req.ExchangeCode)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, session)
}

func (h *Handler) PostAuthLogout(c *gin.Context) {
	token := c.GetString(authTokenKey)
	if token == "" {
		writeAppError(c, newAppError(http.StatusUnauthorized, "missing_token", "missing bearer token"), http.StatusUnauthorized)
		return
	}
	h.services.auth.RevokeSession(c.Request.Context(), token)
	c.Status(http.StatusNoContent)
}

func (h *Handler) GetMe(c *gin.Context) {
	user, memberships, err := h.services.team.CurrentUserAndMemberships(c.Request.Context(), c.GetString(authUserIDKey))
	if err != nil {
		writeAppError(c, err, http.StatusUnauthorized)
		return
	}
	c.JSON(http.StatusOK, api.MeResponse{User: user.toAPI(), Memberships: memberships})
}

func (h *Handler) PostTeamInvite(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	var req api.CreateInviteRequest
	if c.Request.ContentLength > 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			writeAppError(c, newAppError(http.StatusBadRequest, "invalid_request", "invalid request body"), http.StatusBadRequest)
			return
		}
	}

	invite, err := h.services.team.CreateInvite(c.Request.Context(), userID, req)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusCreated, invite)
}

func (h *Handler) PostTeamJoin(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	var req api.JoinTeamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeAppError(c, newAppError(http.StatusBadRequest, "invalid_request", "invalid request body"), http.StatusBadRequest)
		return
	}

	res, err := h.services.team.JoinTeam(c.Request.Context(), userID, req.Code)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListTasks(c *gin.Context, params api.ListTasksParams) {
	userID := c.GetString(authUserIDKey)
	items, err := h.services.task.ListTasks(c.Request.Context(), userID, params.Type)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) PostTask(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	var req api.CreateTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeAppError(c, newAppError(http.StatusBadRequest, "invalid_request", "invalid request body"), http.StatusBadRequest)
		return
	}

	task, err := h.services.task.CreateTask(c.Request.Context(), userID, req)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusCreated, task)
}

func (h *Handler) PatchTask(c *gin.Context, taskID string) {
	userID := c.GetString(authUserIDKey)
	var req api.UpdateTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeAppError(c, newAppError(http.StatusBadRequest, "invalid_request", "invalid request body"), http.StatusBadRequest)
		return
	}
	task, err := h.services.task.PatchTask(c.Request.Context(), userID, taskID, req)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, task)
}

func (h *Handler) DeleteTask(c *gin.Context, taskID string) {
	userID := c.GetString(authUserIDKey)
	if err := h.services.task.DeleteTask(c.Request.Context(), userID, taskID); err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) PostTaskCompletionToggle(c *gin.Context, taskID string) {
	userID := c.GetString(authUserIDKey)
	var req api.ToggleTaskCompletionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeAppError(c, newAppError(http.StatusBadRequest, "invalid_request", "invalid request body"), http.StatusBadRequest)
		return
	}

	res, err := h.services.task.ToggleTaskCompletion(c.Request.Context(), userID, taskID, req.TargetDate.Time)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListPenaltyRules(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	items, err := h.services.penalty.ListPenaltyRules(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) PostPenaltyRule(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	var req api.CreatePenaltyRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeAppError(c, newAppError(http.StatusBadRequest, "invalid_request", "invalid request body"), http.StatusBadRequest)
		return
	}

	rule, err := h.services.penalty.CreatePenaltyRule(c.Request.Context(), userID, req)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusCreated, rule)
}

func (h *Handler) PatchPenaltyRule(c *gin.Context, ruleID string) {
	userID := c.GetString(authUserIDKey)
	var req api.UpdatePenaltyRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeAppError(c, newAppError(http.StatusBadRequest, "invalid_request", "invalid request body"), http.StatusBadRequest)
		return
	}
	rule, err := h.services.penalty.PatchPenaltyRule(c.Request.Context(), userID, ruleID, req)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, rule)
}

func (h *Handler) DeletePenaltyRule(c *gin.Context, ruleID string) {
	userID := c.GetString(authUserIDKey)
	if err := h.services.penalty.DeletePenaltyRule(c.Request.Context(), userID, ruleID); err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) GetHome(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	home, err := h.services.home.GetHome(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, home)
}

func (h *Handler) GetPenaltySummaryMonthly(c *gin.Context, params api.GetPenaltySummaryMonthlyParams) {
	userID := c.GetString(authUserIDKey)
	summary, err := h.services.home.GetMonthlySummary(c.Request.Context(), userID, params.Month)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, summary)
}

func (h *Handler) PostAdminCloseDay(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	res, err := h.services.admin.CloseDayForUser(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) PostAdminCloseWeek(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	res, err := h.services.admin.CloseWeekForUser(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) PostAdminCloseMonth(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	res, err := h.services.admin.CloseMonthForUser(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, res)
}
