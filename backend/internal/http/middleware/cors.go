package middleware

import (
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

// CORS enables basic cross-origin requests for local development.
func CORS() gin.HandlerFunc {
	allowOrigins := map[string]bool{}
	for _, origin := range []string{
		"http://localhost:5173",
		strings.TrimSpace(os.Getenv("FRONTEND_ORIGIN")),
	} {
		if origin == "" {
			continue
		}
		allowOrigins[origin] = true
	}

	return func(c *gin.Context) {
		origin := strings.TrimSpace(c.GetHeader("Origin"))
		if allowOrigins[origin] {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
			c.Writer.Header().Set("Access-Control-Expose-Headers", "ETag")
		}
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, If-Match")
		c.Writer.Header().Set("Vary", "Origin")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}
