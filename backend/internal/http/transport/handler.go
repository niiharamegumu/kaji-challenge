package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/megu/kaji-challenge/backend/internal/http/application/ports"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

type Handler struct {
	services *ports.Services
}

func NewHandler(services *ports.Services) *Handler {
	return &Handler{services: services}
}

func (h *Handler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, api.HealthResponse{Status: "ok"})
}
