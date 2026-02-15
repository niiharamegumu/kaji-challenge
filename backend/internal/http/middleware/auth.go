package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/megu/kaji-challenge/backend/internal/http/application"
	"github.com/megu/kaji-challenge/backend/internal/http/transport"
)

func Auth(auth application.AuthService) gin.HandlerFunc {
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

		authHeader := c.GetHeader("Authorization")
		token := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer"))
		if token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"message": "missing bearer token"})
			c.Abort()
			return
		}

		userID, ok := auth.LookupSession(c.Request.Context(), token)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"message": "invalid bearer token"})
			c.Abort()
			return
		}
		c.Set(transport.AuthUserIDKey, userID)
		c.Set(transport.AuthTokenKey, token)
		c.Next()
	}
}
