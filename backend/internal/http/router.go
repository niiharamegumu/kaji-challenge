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
	return NewRouterWithStore(infra.NewServices(s), s)
}

func NewRouterWithStore(svcs *ports.Services, s *infra.Store) *gin.Engine {
	r := gin.Default()
	r.Use(middleware.CORS())
	r.Use(middleware.Auth(svcs.Auth))
	r.Use(middleware.CSRFSameOrigin())
	h := transport.NewHandler(svcs, s)
	api.RegisterHandlers(r, h)
	r.GET("/v1/events/stream", h.GetEventsStream)
	return r
}

func NewRouterWithServices(svcs *ports.Services) *gin.Engine {
	r := gin.Default()
	r.Use(middleware.CORS())
	r.Use(middleware.Auth(svcs.Auth))
	r.Use(middleware.CSRFSameOrigin())
	h := transport.NewHandler(svcs, nil)
	api.RegisterHandlers(r, h)
	return r
}
