package http

import (
	"github.com/gin-gonic/gin"
	"github.com/megu/kaji-challenge/backend/internal/http/middleware"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func NewRouter() *gin.Engine {
	return NewRouterWithStore(newStore())
}

func NewRouterWithStore(s *store) *gin.Engine {
	r := gin.Default()
	r.Use(middleware.CORS())
	r.Use(authMiddleware(s))
	api.RegisterHandlers(r, &Handler{services: newServices(s)})
	return r
}
