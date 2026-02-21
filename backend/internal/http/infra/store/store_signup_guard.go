package store

import (
	"errors"
	"os"
	"strings"
)

func signupGuardEnabled() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("SIGNUP_GUARD_ENABLED")), "true")
}

func parseSignupAllowedEmails() map[string]struct{} {
	items := strings.Split(strings.TrimSpace(os.Getenv("SIGNUP_ALLOWED_EMAILS")), ",")
	allowed := make(map[string]struct{}, len(items))
	for _, item := range items {
		email := strings.ToLower(strings.TrimSpace(item))
		if email == "" {
			continue
		}
		allowed[email] = struct{}{}
	}
	return allowed
}

func validateSignupGuardSettings() error {
	if !signupGuardEnabled() {
		return nil
	}
	if len(parseSignupAllowedEmails()) == 0 {
		return errors.New("SIGNUP_GUARD_ENABLED=true but SIGNUP_ALLOWED_EMAILS is empty")
	}
	return nil
}

func isSignupAllowedEmail(email string) bool {
	if !signupGuardEnabled() {
		return true
	}
	allowed := parseSignupAllowedEmails()
	_, ok := allowed[strings.ToLower(strings.TrimSpace(email))]
	return ok
}
