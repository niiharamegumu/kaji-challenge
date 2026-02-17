package transport

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (h *Handler) GetAuthGoogleStart(c *gin.Context) {
	res, err := h.services.Auth.StartGoogleAuth(c.Request.Context())
	if err != nil {
		writeAppError(c, err, http.StatusInternalServerError)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetAuthGoogleCallback(c *gin.Context, params api.GetAuthGoogleCallbackParams) {
	exchangeCode, redirectTo, err := h.services.Auth.CompleteGoogleAuth(c.Request.Context(), params.Code, params.State, c.Query("mock_email"), c.Query("mock_name"), c.Query("mock_sub"))
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	if redirectTo != "" {
		sep := "?"
		if strings.Contains(redirectTo, "?") {
			sep = "&"
		}
		c.Redirect(http.StatusFound, redirectTo+sep+"exchangeCode="+url.QueryEscape(exchangeCode))
		return
	}
	c.JSON(http.StatusOK, api.AuthCallbackResponse{ExchangeCode: exchangeCode})
}

func (h *Handler) PostAuthSessionsExchange(c *gin.Context) {
	req, ok := bindJSON[api.AuthSessionExchangeRequest](c)
	if !ok {
		return
	}
	session, err := h.services.Auth.ExchangeSession(c.Request.Context(), req.ExchangeCode)
	if err != nil {
		writeAppError(c, err, http.StatusBadRequest)
		return
	}
	setSessionCookie(c.Writer, session.Token, shouldUseSecureCookie(c.Request))
	c.JSON(http.StatusOK, api.AuthSessionResponse{User: session.User})
}

func (h *Handler) PostAuthLogout(c *gin.Context) {
	token := c.GetString(AuthTokenKey)
	if token == "" {
		writeAppError(c, newAppError(http.StatusUnauthorized, "missing_token", "missing session cookie"), http.StatusUnauthorized)
		return
	}
	h.services.Auth.RevokeSession(c.Request.Context(), token)
	clearSessionCookie(c.Writer, shouldUseSecureCookie(c.Request))
	c.Status(http.StatusNoContent)
}
