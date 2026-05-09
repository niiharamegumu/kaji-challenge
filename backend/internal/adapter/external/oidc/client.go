package oidc

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
	"sort"
	"strings"

	coreosoidc "github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/megu/kaji-challenge/backend/internal/application/ports"
)

type Client struct {
	provider    *coreosoidc.Provider
	verifier    *coreosoidc.IDTokenVerifier
	oauthConfig oauth2.Config
}

type Claims struct {
	Iss   string `json:"iss"`
	Sub   string `json:"sub"`
	Email string `json:"email"`
	Name  string `json:"name"`
	Nonce string `json:"nonce"`
}

type Provider struct {
	client *Client
}

func NewProvider() *Provider {
	return &Provider{}
}

func (p *Provider) Configured() bool {
	return Configured()
}

func (p *Provider) StrictMode() bool {
	return StrictMode()
}

func (p *Provider) ValidateSettings() error {
	return ValidateSettings()
}

func (p *Provider) MockAuthorizationURL(state string) string {
	return MockAuthorizationURL(state)
}

func (p *Provider) AuthorizationURL(ctx context.Context, state, nonce, verifier string) (string, error) {
	client, err := p.ensureClient(ctx)
	if err != nil {
		return "", err
	}
	return client.AuthorizationURL(state, nonce, verifier), nil
}

func (p *Provider) ExchangeAndVerify(ctx context.Context, code, verifier string) (ports.OIDCClaims, error) {
	client, err := p.ensureClient(ctx)
	if err != nil {
		return ports.OIDCClaims{}, err
	}
	claims, err := client.ExchangeAndVerify(ctx, code, verifier)
	if err != nil {
		return ports.OIDCClaims{}, err
	}
	return ports.OIDCClaims{
		Iss:   claims.Iss,
		Sub:   claims.Sub,
		Email: claims.Email,
		Name:  claims.Name,
		Nonce: claims.Nonce,
	}, nil
}

func (p *Provider) ensureClient(ctx context.Context) (*Client, error) {
	if p.client != nil {
		return p.client, nil
	}
	client, err := NewClient(ctx)
	if err != nil {
		return nil, err
	}
	p.client = client
	return p.client, nil
}

func Configured() bool {
	return strings.TrimSpace(os.Getenv("OIDC_ISSUER_URL")) != "" &&
		strings.TrimSpace(os.Getenv("OIDC_CLIENT_ID")) != "" &&
		strings.TrimSpace(os.Getenv("OIDC_CLIENT_SECRET")) != ""
}

func StrictMode() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("OIDC_STRICT_MODE")), "true")
}

func ValidateSettings() error {
	if !StrictMode() {
		return nil
	}
	missing := []string{}
	required := map[string]string{
		"OIDC_ISSUER_URL":    strings.TrimSpace(os.Getenv("OIDC_ISSUER_URL")),
		"OIDC_CLIENT_ID":     strings.TrimSpace(os.Getenv("OIDC_CLIENT_ID")),
		"OIDC_CLIENT_SECRET": strings.TrimSpace(os.Getenv("OIDC_CLIENT_SECRET")),
		"OIDC_REDIRECT_URL":  strings.TrimSpace(os.Getenv("OIDC_REDIRECT_URL")),
	}
	for key, value := range required {
		if value == "" {
			missing = append(missing, key)
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		return fmt.Errorf("OIDC_STRICT_MODE=true but missing required env vars: %s", strings.Join(missing, ", "))
	}
	return nil
}

func NewClient(ctx context.Context) (*Client, error) {
	if !Configured() {
		return nil, errors.New("OIDC is not configured")
	}
	issuer := os.Getenv("OIDC_ISSUER_URL")
	clientID := os.Getenv("OIDC_CLIENT_ID")
	clientSecret := os.Getenv("OIDC_CLIENT_SECRET")
	redirectURL := os.Getenv("OIDC_REDIRECT_URL")
	if redirectURL == "" {
		redirectURL = strings.TrimRight(appBaseURL(), "/") + "/v1/auth/google/callback"
	}
	provider, err := coreosoidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, err
	}
	return &Client{
		provider: provider,
		verifier: provider.Verifier(&coreosoidc.Config{ClientID: clientID}),
		oauthConfig: oauth2.Config{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			Endpoint:     provider.Endpoint(),
			RedirectURL:  redirectURL,
			Scopes:       []string{coreosoidc.ScopeOpenID, "email", "profile"},
		},
	}, nil
}

func MockAuthorizationURL(state string) string {
	return fmt.Sprintf("%s/v1/auth/google/callback?code=mock-code&state=%s&mock_email=%s&mock_name=%s&mock_sub=%s&mock_iss=%s",
		strings.TrimRight(appBaseURL(), "/"),
		url.QueryEscape(state),
		url.QueryEscape("owner@example.com"),
		url.QueryEscape("Owner"),
		url.QueryEscape("mock-sub-owner@example.com"),
		url.QueryEscape("https://mock-issuer.local"),
	)
}

func (c *Client) AuthorizationURL(state, nonce, verifier string) string {
	return c.oauthConfig.AuthCodeURL(
		state,
		oauth2.SetAuthURLParam("nonce", nonce),
		oauth2.SetAuthURLParam("code_challenge", pkceChallenge(verifier)),
		oauth2.SetAuthURLParam("code_challenge_method", "S256"),
	)
}

func (c *Client) ExchangeAndVerify(ctx context.Context, code, verifier string) (Claims, error) {
	tok, err := c.oauthConfig.Exchange(ctx, code, oauth2.SetAuthURLParam("code_verifier", verifier))
	if err != nil {
		return Claims{}, fmt.Errorf("oauth exchange failed: %w", err)
	}
	raw, ok := tok.Extra("id_token").(string)
	if !ok || raw == "" {
		return Claims{}, errors.New("id_token missing")
	}
	verified, err := c.verifier.Verify(ctx, raw)
	if err != nil {
		return Claims{}, fmt.Errorf("id token verify failed: %w", err)
	}
	var claims Claims
	if err := verified.Claims(&claims); err != nil {
		return Claims{}, err
	}
	return claims, nil
}

func appBaseURL() string {
	base := strings.TrimSpace(os.Getenv("APP_BASE_URL"))
	if base == "" {
		return "http://localhost:8080"
	}
	return base
}

func pkceChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
