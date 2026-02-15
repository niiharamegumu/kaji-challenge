package transport

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/megu/kaji-challenge/backend/internal/http/application"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

type Handler struct {
	services *application.Services
}

func NewHandler(services *application.Services) *Handler {
	return &Handler{services: services}
}

func (h *Handler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, api.HealthResponse{Status: "ok"})
}

func (h *Handler) GetAuthGoogleStart(c *gin.Context) {
	res, err := h.services.Auth.StartGoogleAuth(c.Request.Context())
	if err != nil {
		writeAppError(c, err, http.StatusInternalServerError)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetAuthGoogleCallback(c *gin.Context, params api.GetAuthGoogleCallbackParams) {
	exchangeCode, redirectTo, err := h.services.Auth.CompleteGoogleAuth(c.Request.Context(), params.Code, params.State, c.Query("mock_email"), c.Query("mock_name"), c.Query("mock_sub"))
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
	session, err := h.services.Auth.ExchangeSession(c.Request.Context(), req.ExchangeCode)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, session)
}

func (h *Handler) PostAuthLogout(c *gin.Context) {
	token := c.GetString(AuthTokenKey)
	if token == "" {
		writeAppError(c, newAppError(http.StatusUnauthorized, "missing_token", "missing bearer token"), http.StatusUnauthorized)
		return
	}
	h.services.Auth.RevokeSession(c.Request.Context(), token)
	c.Status(http.StatusNoContent)
}

func (h *Handler) GetMe(c *gin.Context) {
	res, err := h.services.Team.GetMe(c.Request.Context(), c.GetString(AuthUserIDKey))
	if err != nil {
		writeAppError(c, err, http.StatusUnauthorized)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) PostTeamInvite(c *gin.Context) {
	userID := c.GetString(AuthUserIDKey)
	var req api.CreateInviteRequest
	if c.Request.ContentLength > 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			writeAppError(c, newAppError(http.StatusBadRequest, "invalid_request", "invalid request body"), http.StatusBadRequest)
			return
		}
	}
	invite, err := h.services.Team.CreateInvite(c.Request.Context(), userID, req)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusCreated, invite)
}

func (h *Handler) PostTeamJoin(c *gin.Context) {
	userID := c.GetString(AuthUserIDKey)
	var req api.JoinTeamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeAppError(c, newAppError(http.StatusBadRequest, "invalid_request", "invalid request body"), http.StatusBadRequest)
		return
	}
	res, err := h.services.Team.JoinTeam(c.Request.Context(), userID, req.Code)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListTasks(c *gin.Context, params api.ListTasksParams) {
	userID := c.GetString(AuthUserIDKey)
	items, err := h.services.Task.ListTasks(c.Request.Context(), userID, params.Type)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) PostTask(c *gin.Context) {
	userID := c.GetString(AuthUserIDKey)
	var req api.CreateTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeAppError(c, newAppError(http.StatusBadRequest, "invalid_request", "invalid request body"), http.StatusBadRequest)
		return
	}
	task, err := h.services.Task.CreateTask(c.Request.Context(), userID, req)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusCreated, task)
}

func (h *Handler) PatchTask(c *gin.Context, taskID string) {
	userID := c.GetString(AuthUserIDKey)
	var req api.UpdateTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeAppError(c, newAppError(http.StatusBadRequest, "invalid_request", "invalid request body"), http.StatusBadRequest)
		return
	}
	task, err := h.services.Task.PatchTask(c.Request.Context(), userID, taskID, req)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, task)
}

func (h *Handler) DeleteTask(c *gin.Context, taskID string) {
	userID := c.GetString(AuthUserIDKey)
	if err := h.services.Task.DeleteTask(c.Request.Context(), userID, taskID); err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) PostTaskCompletionToggle(c *gin.Context, taskID string) {
	userID := c.GetString(AuthUserIDKey)
	var req api.ToggleTaskCompletionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeAppError(c, newAppError(http.StatusBadRequest, "invalid_request", "invalid request body"), http.StatusBadRequest)
		return
	}
	res, err := h.services.Task.ToggleTaskCompletion(c.Request.Context(), userID, taskID, req.TargetDate.Time)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListPenaltyRules(c *gin.Context) {
	userID := c.GetString(AuthUserIDKey)
	items, err := h.services.Penalty.ListPenaltyRules(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) PostPenaltyRule(c *gin.Context) {
	userID := c.GetString(AuthUserIDKey)
	var req api.CreatePenaltyRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeAppError(c, newAppError(http.StatusBadRequest, "invalid_request", "invalid request body"), http.StatusBadRequest)
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
	userID := c.GetString(AuthUserIDKey)
	var req api.UpdatePenaltyRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeAppError(c, newAppError(http.StatusBadRequest, "invalid_request", "invalid request body"), http.StatusBadRequest)
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
	userID := c.GetString(AuthUserIDKey)
	if err := h.services.Penalty.DeletePenaltyRule(c.Request.Context(), userID, ruleID); err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) GetHome(c *gin.Context) {
	userID := c.GetString(AuthUserIDKey)
	home, err := h.services.Home.GetHome(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, home)
}

func (h *Handler) GetPenaltySummaryMonthly(c *gin.Context, params api.GetPenaltySummaryMonthlyParams) {
	userID := c.GetString(AuthUserIDKey)
	summary, err := h.services.Home.GetMonthlySummary(c.Request.Context(), userID, params.Month)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, summary)
}

func (h *Handler) PostAdminCloseDay(c *gin.Context) {
	userID := c.GetString(AuthUserIDKey)
	res, err := h.services.Admin.CloseDayForUser(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) PostAdminCloseWeek(c *gin.Context) {
	userID := c.GetString(AuthUserIDKey)
	res, err := h.services.Admin.CloseWeekForUser(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) PostAdminCloseMonth(c *gin.Context) {
	userID := c.GetString(AuthUserIDKey)
	res, err := h.services.Admin.CloseMonthForUser(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, res)
}
