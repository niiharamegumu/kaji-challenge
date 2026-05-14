package oidc

import (
	"context"
	"net/url"
	"strings"
	"testing"

	"golang.org/x/oauth2"
)

func TestValidateSettingsRequiresStrictModeEnv(t *testing.T) {
	t.Setenv("OIDC_STRICT_MODE", "true")
	t.Setenv("OIDC_ISSUER_URL", "")
	t.Setenv("OIDC_CLIENT_ID", "client")
	t.Setenv("OIDC_CLIENT_SECRET", "")
	t.Setenv("OIDC_REDIRECT_URL", "")

	err := ValidateSettings()
	if err == nil {
		t.Fatal("expected missing env error")
	}
	msg := err.Error()
	for _, want := range []string{"OIDC_CLIENT_SECRET", "OIDC_ISSUER_URL", "OIDC_REDIRECT_URL"} {
		if !strings.Contains(msg, want) {
			t.Fatalf("ValidateSettings error %q does not contain %q", msg, want)
		}
	}
}

func TestProviderUsesMockAndStrictModeHelpers(t *testing.T) {
	t.Setenv("APP_BASE_URL", "https://app.example.com/")
	t.Setenv("OIDC_STRICT_MODE", "true")
	t.Setenv("OIDC_ISSUER_URL", "https://issuer.example.com")
	t.Setenv("OIDC_CLIENT_ID", "client")
	t.Setenv("OIDC_CLIENT_SECRET", "secret")

	provider := NewProvider()
	if !provider.Configured() {
		t.Fatal("expected provider to be configured")
	}
	if !provider.StrictMode() {
		t.Fatal("expected strict mode")
	}
	rawURL := provider.MockAuthorizationURL("state value")
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("MockAuthorizationURL parse failed: %v", err)
	}
	if parsed.Scheme != "https" || parsed.Host != "app.example.com" {
		t.Fatalf("unexpected mock URL host: %s", rawURL)
	}
	if parsed.Query().Get("state") != "state value" {
		t.Fatalf("state query = %q", parsed.Query().Get("state"))
	}
}

func TestClientAuthorizationURLIncludesNonceAndPKCE(t *testing.T) {
	client := &Client{
		oauthConfig: oauth2.Config{
			ClientID:    "client-id",
			RedirectURL: "https://app.example.com/callback",
			Endpoint: oauth2.Endpoint{
				AuthURL: "https://issuer.example.com/auth",
			},
			Scopes: []string{"openid", "email", "profile"},
		},
	}

	rawURL := client.AuthorizationURL("state-1", "nonce-1", "verifier-1")
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("AuthorizationURL parse failed: %v", err)
	}
	query := parsed.Query()
	if query.Get("state") != "state-1" {
		t.Fatalf("state = %q", query.Get("state"))
	}
	if query.Get("nonce") != "nonce-1" {
		t.Fatalf("nonce = %q", query.Get("nonce"))
	}
	if query.Get("code_challenge") != pkceChallenge("verifier-1") {
		t.Fatalf("code_challenge = %q", query.Get("code_challenge"))
	}
	if query.Get("code_challenge_method") != "S256" {
		t.Fatalf("code_challenge_method = %q", query.Get("code_challenge_method"))
	}
}

func TestProviderAuthorizationURLReturnsConfigurationError(t *testing.T) {
	t.Setenv("OIDC_ISSUER_URL", "")
	t.Setenv("OIDC_CLIENT_ID", "")
	t.Setenv("OIDC_CLIENT_SECRET", "")

	provider := NewProvider()
	if _, err := provider.AuthorizationURL(context.Background(), "state", "nonce", "verifier"); err == nil {
		t.Fatal("expected configuration error")
	}
}
