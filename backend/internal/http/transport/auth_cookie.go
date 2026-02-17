package transport

import (
	"net/http"
	"os"
	"strconv"
	"strings"
)

const (
	SessionCookieName = "kaji_session"
	sessionMaxAgeSec  = 30 * 24 * 60 * 60
)

func setSessionCookie(w http.ResponseWriter, token string, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   sessionMaxAgeSec,
		Secure:   secure,
	})
}

func clearSessionCookie(w http.ResponseWriter, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
		Secure:   secure,
	})
}

func shouldUseSecureCookie(r *http.Request) bool {
	raw := strings.TrimSpace(os.Getenv("COOKIE_SECURE"))
	if raw != "" {
		value, err := strconv.ParseBool(raw)
		if err == nil {
			return value
		}
	}
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
}
