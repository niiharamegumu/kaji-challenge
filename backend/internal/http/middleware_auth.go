package http

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

func authMiddleware(s *store) gin.HandlerFunc {
	publicPaths := map[string]bool{
		"/health":                    true,
		"/v1/auth/google/start":      true,
		"/v1/auth/google/callback":   true,
		"/v1/auth/sessions/exchange": true,
	}

	return func(c *gin.Context) {
		if c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}
		if publicPaths[c.Request.URL.Path] {
			c.Next()
			return
		}

		auth := c.GetHeader("Authorization")
		token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer"))
		if token == "" {
			writeError(c, http.StatusUnauthorized, "missing bearer token")
			c.Abort()
			return
		}

		userID, ok := s.lookupSession(c.Request.Context(), token)
		if !ok {
			writeError(c, http.StatusUnauthorized, "invalid bearer token")
			c.Abort()
			return
		}
		c.Set(authUserIDKey, userID)
		c.Set(authTokenKey, token)
		c.Next()
	}
}
