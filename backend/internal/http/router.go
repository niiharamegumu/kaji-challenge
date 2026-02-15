package http

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/megu/kaji-challenge/backend/internal/http/middleware"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

type Handler struct{}

func NewRouter() *gin.Engine {
	r := gin.Default()
	r.Use(middleware.CORS())
	api.RegisterHandlers(r, &Handler{})
	return r
}

func (h *Handler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, api.HealthResponse{Status: "ok"})
}

func (h *Handler) GetMe(c *gin.Context) {
	c.JSON(http.StatusOK, api.MeResponse{
		UserId:      "user_stub",
		TeamId:      "team_stub",
		DisplayName: "Taro",
	})
}

func (h *Handler) GetHomeSummary(c *gin.Context) {
	c.JSON(http.StatusOK, api.HomeSummaryResponse{
		Month:               "2026-02",
		MonthlyPenaltyTotal: 0,
		DailyOpenCount:      0,
		WeeklyOpenCount:     0,
	})
}
