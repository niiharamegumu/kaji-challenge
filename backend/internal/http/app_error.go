package http

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

type AppError struct {
	Status  int
	Code    string
	Message string
}

func (e *AppError) Error() string {
	return e.Message
}

func newAppError(status int, code, message string) *AppError {
	return &AppError{Status: status, Code: code, Message: message}
}

func writeError(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{"message": message})
}

func writeAppError(c *gin.Context, err error, defaultStatus int) {
	if err == nil {
		return
	}
	var appErr *AppError
	if errors.As(err, &appErr) {
		writeError(c, appErr.Status, appErr.Message)
		return
	}
	status := mapErrorStatus(err, defaultStatus)
	writeError(c, status, err.Error())
}

func mapErrorStatus(err error, defaultStatus int) int {
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "missing bearer token"), strings.Contains(msg, "invalid bearer token"):
		return http.StatusUnauthorized
	case strings.Contains(msg, "not found"):
		return http.StatusNotFound
	case strings.Contains(msg, "expired"), strings.Contains(msg, "disabled"), strings.Contains(msg, "invalid"):
		return http.StatusBadRequest
	default:
		return defaultStatus
	}
}
