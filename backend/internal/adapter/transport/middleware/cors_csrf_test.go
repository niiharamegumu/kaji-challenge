package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCORSAllowsConfiguredOriginsAndHandlesPreflight(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("FRONTEND_ORIGIN", "https://app.example.test")
	router := gin.New()
	router.Use(CORS())
	router.GET("/resource", func(c *gin.Context) { c.Status(http.StatusOK) })

	req := httptest.NewRequest(http.MethodOptions, "/resource", nil)
	req.Header.Set("Origin", "https://app.example.test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example.test" {
		t.Fatalf("allow origin = %q", got)
	}
	if got := rec.Header().Get("Access-Control-Expose-Headers"); got != "ETag" {
		t.Fatalf("expose headers = %q", got)
	}
}

func TestCORSDoesNotEchoUnknownOrigin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(CORS())
	router.GET("/resource", func(c *gin.Context) { c.Status(http.StatusOK) })

	req := httptest.NewRequest(http.MethodGet, "/resource", nil)
	req.Header.Set("Origin", "https://evil.example.test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("unexpected allow origin = %q", got)
	}
}

func TestCSRFSameOriginAllowsSafeAndPublicPaths(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(CSRFSameOrigin())
	router.GET("/private", func(c *gin.Context) { c.Status(http.StatusOK) })
	router.POST("/v1/auth/google/callback", func(c *gin.Context) { c.Status(http.StatusOK) })

	for _, tt := range []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/private"},
		{method: http.MethodPost, path: "/v1/auth/google/callback"},
	} {
		req := httptest.NewRequest(tt.method, tt.path, nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s %s status = %d, want %d", tt.method, tt.path, rec.Code, http.StatusOK)
		}
	}
}

func TestCSRFSameOriginRejectsMissingInvalidAndUnknownOrigins(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(CSRFSameOrigin())
	router.POST("/private", func(c *gin.Context) { c.Status(http.StatusOK) })

	for _, tt := range []struct {
		name   string
		origin string
	}{
		{name: "missing"},
		{name: "invalid", origin: "://bad"},
		{name: "unknown", origin: "https://evil.example.test"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/private", nil)
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
			}
		})
	}
}

func TestCSRFSameOriginAllowsConfiguredOrigin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("FRONTEND_ORIGIN", "https://app.example.test")
	router := gin.New()
	router.Use(CSRFSameOrigin())
	router.POST("/private", func(c *gin.Context) { c.Status(http.StatusOK) })

	req := httptest.NewRequest(http.MethodPost, "/private", nil)
	req.Header.Set("Origin", "https://app.example.test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}
