package transport

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/megu/kaji-challenge/backend/internal/http/infra/store"
)

func injectIfMatchContext(c *gin.Context) {
	ifMatch := strings.TrimSpace(c.GetHeader("If-Match"))
	if ifMatch == "" {
		return
	}
	c.Request = c.Request.WithContext(store.NewIfMatchContext(c.Request.Context(), ifMatch))
}

func (h *Handler) writeTeamETag(c *gin.Context, userID string) {
	if h.syncProvider == nil || userID == "" {
		return
	}
	etag, err := h.syncProvider.TeamETagForUser(c.Request.Context(), userID)
	if err != nil || etag == "" {
		return
	}
	c.Header("ETag", etag)
}
