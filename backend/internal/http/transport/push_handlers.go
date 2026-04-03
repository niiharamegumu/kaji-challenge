package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (h *Handler) PostPushSubscription(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	req, ok := bindJSON[api.UpsertPushSubscriptionRequest](c)
	if !ok {
		return
	}
	subscription, err := h.services.Push.UpsertPushSubscription(c.Request.Context(), userID, req)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, subscription)
}

func (h *Handler) DeletePushSubscription(c *gin.Context, subscriptionID string) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	if err := h.services.Push.DeletePushSubscription(c.Request.Context(), userID, subscriptionID); err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) GetPushSubscriptionsMe(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	res, err := h.services.Push.ListPushSubscriptions(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, res)
}
