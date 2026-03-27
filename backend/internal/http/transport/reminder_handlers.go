package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (h *Handler) ListReminders(c *gin.Context, params api.ListRemindersParams) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	items, err := h.services.Reminder.ListReminders(c.Request.Context(), userID, params.From.Time, params.To.Time)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	h.writeTeamETag(c, userID)
	c.JSON(http.StatusOK, api.ReminderCalendarResponse{Days: items})
}

func (h *Handler) ListReminderDefinitions(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	items, err := h.services.Reminder.ListReminderDefinitions(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	h.writeTeamETag(c, userID)
	c.JSON(http.StatusOK, api.ReminderListResponse{Items: items})
}

func (h *Handler) PostReminder(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	req, ok := bindJSON[api.CreateReminderRequest](c)
	if !ok {
		return
	}
	item, err := h.services.Reminder.CreateReminder(c.Request.Context(), userID, req)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	h.writeTeamETag(c, userID)
	c.JSON(http.StatusCreated, item)
}

func (h *Handler) PatchReminder(c *gin.Context, reminderID string) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	req, ok := bindJSON[api.UpdateReminderRequest](c)
	if !ok {
		return
	}
	item, err := h.services.Reminder.PatchReminder(c.Request.Context(), userID, reminderID, req)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	h.writeTeamETag(c, userID)
	c.JSON(http.StatusOK, item)
}

func (h *Handler) DeleteReminder(c *gin.Context, reminderID string) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	injectIfMatchContext(c)
	if err := h.services.Reminder.DeleteReminder(c.Request.Context(), userID, reminderID); err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	h.writeTeamETag(c, userID)
	c.Status(http.StatusNoContent)
}
