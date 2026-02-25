package transport

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/megu/kaji-challenge/backend/internal/http/application"
)

const (
	AuthUserIDKey = "auth.userId"
	AuthTokenKey  = "auth.token"
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
	var preconditionErr *application.PreconditionError
	if errors.As(err, &preconditionErr) {
		c.JSON(http.StatusPreconditionFailed, gin.H{
			"code":        "precondition_failed",
			"message":     preconditionErr.Error(),
			"currentEtag": preconditionErr.CurrentETag,
		})
		return
	}
	var appErr *AppError
	if errors.As(err, &appErr) {
		writeError(c, appErr.Status, appErr.Message)
		return
	}
	writeError(c, mapErrorStatus(err, defaultStatus), err.Error())
}

func mapErrorStatus(err error, defaultStatus int) int {
	switch {
	case errors.Is(err, application.ErrUnauthorized):
		return http.StatusUnauthorized
	case errors.Is(err, application.ErrForbidden):
		return http.StatusForbidden
	case errors.Is(err, application.ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, application.ErrInvalid):
		return http.StatusBadRequest
	case errors.Is(err, application.ErrConflict):
		return http.StatusConflict
	case errors.Is(err, application.ErrPrecondition):
		return http.StatusPreconditionFailed
	case errors.Is(err, application.ErrInternal):
		return http.StatusInternalServerError
	default:
		return defaultStatus
	}
}
