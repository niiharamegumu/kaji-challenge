package http

import (
	"github.com/gin-gonic/gin"
	"github.com/megu/kaji-challenge/backend/internal/http/application/ports"
	"github.com/megu/kaji-challenge/backend/internal/http/infra"
	"github.com/megu/kaji-challenge/backend/internal/http/middleware"
	"github.com/megu/kaji-challenge/backend/internal/http/transport"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func NewRouter() *gin.Engine {
	s := infra.NewStore()
	return NewRouterWithServices(infra.NewServices(s))
}

func NewRouterWithServices(svcs *ports.Services) *gin.Engine {
	r := gin.Default()
	r.Use(middleware.CORS())
	r.Use(middleware.Auth(svcs.Auth))
	api.RegisterHandlers(r, transport.NewHandler(svcs))
	return r
}
