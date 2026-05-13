package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/megu/kaji-challenge/backend/internal/adapter/transport/authctx"
	"github.com/megu/kaji-challenge/backend/internal/application/ports"
)

func Auth(auth ports.AuthService) gin.HandlerFunc {
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

		token, err := c.Cookie(authctx.SessionCookieName)
		if err != nil || token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"message": "missing session cookie"})
			c.Abort()
			return
		}

		userID, ok := auth.LookupSession(c.Request.Context(), token)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"message": "invalid session cookie"})
			c.Abort()
			return
		}
		c.Set(authctx.UserIDKey, userID)
		c.Set(authctx.TokenKey, token)
		c.Next()
	}
}
