package transport

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
)

func bindJSON[T any](c *gin.Context) (T, bool) {
	var req T
	if err := c.ShouldBindJSON(&req); err != nil {
		writeAppError(c, newAppError(http.StatusBadRequest, "invalid_request", "invalid request body"), http.StatusBadRequest)
		return req, false
	}
	return req, true
}

func convertTransportModel[T any](c *gin.Context, value any) (T, bool) {
	var out T
	raw, err := json.Marshal(value)
	if err != nil {
		writeAppError(c, newAppError(http.StatusInternalServerError, "conversion_failed", "failed to convert request"), http.StatusInternalServerError)
		return out, false
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		writeAppError(c, newAppError(http.StatusInternalServerError, "conversion_failed", "failed to convert request"), http.StatusInternalServerError)
		return out, false
	}
	return out, true
}

func mustUserID(c *gin.Context) (string, bool) {
	userID := c.GetString(AuthUserIDKey)
	if userID == "" {
		writeAppError(c, newAppError(http.StatusUnauthorized, "missing_user", "missing authenticated user"), http.StatusUnauthorized)
		return "", false
	}
	return userID, true
}
