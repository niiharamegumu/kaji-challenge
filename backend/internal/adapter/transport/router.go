package transport

import (
	"github.com/gin-gonic/gin"
	"github.com/megu/kaji-challenge/backend/internal/adapter/transport/middleware"
	"github.com/megu/kaji-challenge/backend/internal/application/ports"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func NewRouter(svcs *ports.Services, syncProvider syncProvider) *gin.Engine {
	r := gin.Default()
	r.Use(middleware.CORS())
	r.Use(middleware.Auth(svcs.Auth))
	r.Use(middleware.CSRFSameOrigin())
	h := NewHandler(svcs, syncProvider)
	api.RegisterHandlers(r, h)
	return r
}

func NewRouterWithServices(svcs *ports.Services) *gin.Engine {
	return NewRouter(svcs, nil)
}
