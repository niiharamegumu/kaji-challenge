package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/megu/kaji-challenge/backend/internal/adapter/transport/authctx"
	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	"github.com/megu/kaji-challenge/backend/internal/application/ports"
)

type fakeAuthService struct {
	sessions map[string]string
}

func (f fakeAuthService) ValidateSettings() error { return nil }

func (f fakeAuthService) StartGoogleAuth(context.Context) (model.AuthStartResponse, error) {
	return model.AuthStartResponse{}, nil
}

func (f fakeAuthService) CompleteGoogleAuth(context.Context, string, string, string, string, string, string) (string, string, error) {
	return "", "", nil
}

func (f fakeAuthService) ExchangeSession(context.Context, string) (ports.AuthSession, error) {
	return ports.AuthSession{}, nil
}

func (f fakeAuthService) RevokeSession(context.Context, string) {}

func (f fakeAuthService) LookupSession(_ context.Context, token string) (string, bool) {
	userID, ok := f.sessions[token]
	return userID, ok
}

func TestAuthAllowsPublicAndOptionsRequests(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(Auth(fakeAuthService{}))
	router.GET("/health", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})
	router.OPTIONS("/v1/tasks", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	for _, tt := range []struct {
		method string
		path   string
		want   int
	}{
		{method: http.MethodGet, path: "/health", want: http.StatusOK},
		{method: http.MethodOptions, path: "/v1/tasks", want: http.StatusNoContent},
	} {
		req := httptest.NewRequest(tt.method, tt.path, nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != tt.want {
			t.Fatalf("%s %s status = %d, want %d", tt.method, tt.path, rec.Code, tt.want)
		}
	}
}

func TestAuthRejectsMissingAndInvalidSessionCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(Auth(fakeAuthService{sessions: map[string]string{"valid-token": "user-1"}}))
	router.GET("/v1/tasks", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/tasks", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing cookie status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/tasks", nil)
	req.AddCookie(&http.Cookie{Name: "kaji_session", Value: "invalid-token"})
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("invalid cookie status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestAuthStoresUserAndTokenForValidSession(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(Auth(fakeAuthService{sessions: map[string]string{"valid-token": "user-1"}}))
	router.GET("/v1/tasks", func(c *gin.Context) {
		userID, _ := c.Get(authctx.UserIDKey)
		token, _ := c.Get(authctx.TokenKey)
		c.JSON(http.StatusOK, gin.H{"userID": userID, "token": token})
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/tasks", nil)
	req.AddCookie(&http.Cookie{Name: "kaji_session", Value: "valid-token"})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid cookie status = %d, want %d", rec.Code, http.StatusOK)
	}
	if body := rec.Body.String(); body != `{"token":"valid-token","userID":"user-1"}` {
		t.Fatalf("body = %s", body)
	}
}
