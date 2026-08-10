package transport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/megu/kaji-challenge/backend/internal/application"
)

func TestBindJSONRejectsOversizedBody(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/payload", func(c *gin.Context) {
		if _, ok := bindJSON[struct {
			Value string `json:"value"`
		}](c); ok {
			c.Status(http.StatusNoContent)
		}
	})

	body := `{"value":"` + strings.Repeat("a", int(maxJSONBodyBytes)) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/payload", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusBadRequest)
	}
}

func TestWriteAppErrorHidesInternalDetails(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/failure", func(c *gin.Context) {
		writeAppError(c, fmt.Errorf("%w: database password leaked", application.ErrInternal), http.StatusInternalServerError)
	})

	res := httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/failure", nil))

	if res.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusInternalServerError)
	}
	var body map[string]string
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["message"] != internalErrorMessage {
		t.Fatalf("message = %q, want %q", body["message"], internalErrorMessage)
	}
	if strings.Contains(res.Body.String(), "password") {
		t.Fatalf("response leaked internal detail: %s", res.Body.String())
	}
}

func TestWriteAppErrorKeepsPublicValidationMessage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/failure", func(c *gin.Context) {
		writeAppError(c, fmt.Errorf("%w: title is required", application.ErrInvalid), http.StatusBadRequest)
	})

	res := httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/failure", nil))
	if !strings.Contains(res.Body.String(), "title is required") {
		t.Fatalf("validation detail was removed: %s", res.Body.String())
	}
}
