package transport

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/megu/kaji-challenge/backend/internal/application/ports"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

type syncProvider interface {
	TeamETagForUser(ctx context.Context, userID string) (string, error)
}

type Handler struct {
	services     *ports.Services
	syncProvider syncProvider
}

func NewHandler(services *ports.Services, syncProvider syncProvider) *Handler {
	return &Handler{
		services:     services,
		syncProvider: syncProvider,
	}
}

func (h *Handler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, api.HealthResponse{Status: "ok"})
}
