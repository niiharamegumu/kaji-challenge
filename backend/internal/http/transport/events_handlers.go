package transport

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

func (h *Handler) GetEventsStream(c *gin.Context) {
	userID, ok := mustUserID(c)
	if !ok {
		return
	}
	if h.syncProvider == nil {
		writeAppError(c, newAppError(http.StatusServiceUnavailable, "realtime_unavailable", "realtime stream is unavailable"), http.StatusServiceUnavailable)
		return
	}

	teamID, revision, stream, cancel, err := h.syncProvider.TeamEventStreamForUser(c.Request.Context(), userID)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	defer cancel()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Writer.WriteHeader(http.StatusOK)

	c.SSEvent("connected", gin.H{
		"teamId":    teamID,
		"revision":  revision,
		"changedAt": time.Now(),
	})
	c.Writer.Flush()

	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-heartbeat.C:
			c.SSEvent("heartbeat", gin.H{
				"at": time.Now(),
			})
			c.Writer.Flush()
		case event, ok := <-stream:
			if !ok {
				return
			}
			c.SSEvent("team-state-changed", event)
			c.Writer.Flush()
		}
	}
}
