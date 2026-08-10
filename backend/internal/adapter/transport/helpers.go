package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

const maxJSONBodyBytes int64 = 1 << 20

func bindJSON[T any](c *gin.Context) (T, bool) {
	var req T
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxJSONBodyBytes)
	if err := c.ShouldBindJSON(&req); err != nil {
		writeAppError(c, newAppError(http.StatusBadRequest, "invalid_request", "invalid request body"), http.StatusBadRequest)
		return req, false
	}
	return req, true
}

func mustUserID(c *gin.Context) (string, bool) {
	userID := c.GetString(AuthUserIDKey)
	if userID == "" {
		writeAppError(c, newAppError(http.StatusUnauthorized, "missing_user", "missing authenticated user"), http.StatusUnauthorized)
		return "", false
	}
	return userID, true
}
