package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (h *Handler) GetHome(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	home, err := h.services.Home.GetHome(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, home)
}

func (h *Handler) GetPenaltySummaryMonthly(c *gin.Context, params api.GetPenaltySummaryMonthlyParams) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	summary, err := h.services.Home.GetMonthlySummary(c.Request.Context(), userID, params.Month)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, summary)
}
