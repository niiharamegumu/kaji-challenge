package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (h *Handler) GetAdminMonthCloseCandidate(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	res, err := h.services.Admin.GetMonthCloseCandidate(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	h.writeTeamETag(c, userID)
	c.JSON(http.StatusOK, res)
}

func (h *Handler) PostAdminMonthClose(c *gin.Context, month string) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	res, err := h.services.Admin.CloseMonthForUserTarget(c.Request.Context(), userID, month)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	h.writeTeamETag(c, userID)
	c.JSON(http.StatusOK, res)
}
