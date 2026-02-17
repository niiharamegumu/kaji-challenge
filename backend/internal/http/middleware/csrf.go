package middleware

import (
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

func CSRFSameOrigin() gin.HandlerFunc {
	publicPaths := map[string]bool{
		"/health":                  true,
		"/v1/auth/google/start":    true,
		"/v1/auth/google/callback": true,
	}

	allowedOrigins := map[string]bool{}
	for _, origin := range []string{
		"http://localhost:5173",
		strings.TrimSpace(os.Getenv("FRONTEND_ORIGIN")),
	} {
		if origin == "" {
			continue
		}
		allowedOrigins[origin] = true
	}

	return func(c *gin.Context) {
		method := c.Request.Method
		if method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions {
			c.Next()
			return
		}
		if publicPaths[c.Request.URL.Path] {
			c.Next()
			return
		}

		origin := strings.TrimSpace(c.GetHeader("Origin"))
		if origin == "" {
			c.JSON(http.StatusForbidden, gin.H{"message": "missing origin"})
			c.Abort()
			return
		}
		parsed, err := url.Parse(origin)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			c.JSON(http.StatusForbidden, gin.H{"message": "invalid origin"})
			c.Abort()
			return
		}
		if !allowedOrigins[origin] {
			c.JSON(http.StatusForbidden, gin.H{"message": "origin not allowed"})
			c.Abort()
			return
		}

		c.Next()
	}
}
