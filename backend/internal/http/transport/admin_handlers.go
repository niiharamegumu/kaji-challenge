package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (h *Handler) PostAdminCloseDay(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	res, err := h.services.Admin.CloseDayForUser(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) PostAdminCloseWeek(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	res, err := h.services.Admin.CloseWeekForUser(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) PostAdminCloseMonth(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	res, err := h.services.Admin.CloseMonthForUser(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, res)
}
