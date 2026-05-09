package usecases

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	"github.com/megu/kaji-challenge/backend/internal/application/ports"
)

func (u authUsecase) StartGoogleAuth(ctx context.Context) (model.AuthStartResponse, error) {
	if err := u.validateOIDCSettings(); err != nil {
		return model.AuthStartResponse{}, err
	}
	state, err := randomToken()
	if err != nil {
		return model.AuthStartResponse{}, err
	}
	nonce, err := randomToken()
	if err != nil {
		return model.AuthStartResponse{}, err
	}
	verifier, err := randomToken()
	if err != nil {
		return model.AuthStartResponse{}, err
	}
	expiresAt := time.Now().Add(10 * time.Minute)
	if err := u.repo.CreateAuthRequest(ctx, state, nonce, verifier, expiresAt); err != nil {
		return model.AuthStartResponse{}, err
	}
	authURL, err := u.authorizationURL(ctx, state, nonce, verifier)
	if err != nil {
		return model.AuthStartResponse{}, err
	}
	return model.AuthStartResponse{AuthorizationUrl: authURL}, nil
}

func (u authUsecase) CompleteGoogleAuth(ctx context.Context, code, state, mockEmail, mockName, mockSub, mockIss string) (string, string, error) {
	req, err := u.repo.ConsumeAuthRequest(ctx, state, time.Now())
	if err != nil {
		return "", "", err
	}

	email := strings.TrimSpace(strings.ToLower(mockEmail))
	name := strings.TrimSpace(mockName)
	sub := strings.TrimSpace(mockSub)
	issuer := strings.TrimSpace(mockIss)
	if u.strictMode() && (email != "" || name != "" || sub != "" || issuer != "") {
		return "", "", errors.New("mock callback params are disabled when OIDC_STRICT_MODE=true")
	}

	if email == "" {
		claims, err := u.exchangeAndVerify(ctx, code, req.CodeVerifier)
		if err != nil {
			return "", "", err
		}
		if claims.Nonce != req.Nonce {
			return "", "", errors.New("nonce mismatch")
		}
		email = strings.TrimSpace(strings.ToLower(claims.Email))
		name = strings.TrimSpace(claims.Name)
		sub = strings.TrimSpace(claims.Sub)
		issuer = strings.TrimSpace(claims.Iss)
	}
	if email == "" {
		return "", "", errors.New("email not available from provider")
	}
	if sub == "" {
		return "", "", errors.New("sub not available from provider")
	}
	if issuer == "" {
		issuer = "https://mock-issuer.local"
	}
	if name == "" {
		name = strings.Split(email, "@")[0]
	}

	user, err := u.repo.GetOrCreateAuthUser(ctx, issuer, sub, email, name)
	if err != nil {
		return "", "", err
	}
	exchangeCode, err := u.repo.CreateExchangeCode(ctx, user.UserID, time.Now().Add(2*time.Minute))
	if err != nil {
		return "", "", err
	}
	return exchangeCode, strings.TrimSpace(os.Getenv("FRONTEND_CALLBACK_URL")), nil
}

func (u authUsecase) ExchangeSession(ctx context.Context, exchangeCode string) (ports.AuthSession, error) {
	return u.repo.ExchangeSession(ctx, exchangeCode)
}

func (u authUsecase) RevokeSession(ctx context.Context, token string) {
	u.repo.RevokeSession(ctx, token)
}

func (u authUsecase) LookupSession(ctx context.Context, token string) (string, bool) {
	return u.repo.LookupSession(ctx, token)
}

func (u authUsecase) validateOIDCSettings() error {
	if u.oidc == nil {
		return nil
	}
	return u.oidc.ValidateSettings()
}

func (u authUsecase) strictMode() bool {
	return u.oidc != nil && u.oidc.StrictMode()
}

func (u authUsecase) authorizationURL(ctx context.Context, state, nonce, verifier string) (string, error) {
	if u.oidc == nil || !u.oidc.Configured() {
		if u.strictMode() {
			return "", errors.New("OIDC_STRICT_MODE=true requires OIDC configuration")
		}
		if u.oidc != nil {
			return u.oidc.MockAuthorizationURL(state), nil
		}
		return mockAuthorizationURL(state), nil
	}
	return u.oidc.AuthorizationURL(ctx, state, nonce, verifier)
}

func (u authUsecase) exchangeAndVerify(ctx context.Context, code, verifier string) (ports.OIDCClaims, error) {
	if u.oidc == nil {
		return ports.OIDCClaims{}, errors.New("OIDC is not configured")
	}
	return u.oidc.ExchangeAndVerify(ctx, code, verifier)
}

func randomToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func mockAuthorizationURL(state string) string {
	return strings.TrimRight(appBaseURL(), "/") + "/v1/auth/google/callback?code=mock-code&state=" + state +
		"&mock_email=owner%40example.com&mock_name=Owner&mock_sub=mock-sub-owner%40example.com&mock_iss=https%3A%2F%2Fmock-issuer.local"
}

func appBaseURL() string {
	base := strings.TrimSpace(os.Getenv("APP_BASE_URL"))
	if base == "" {
		return "http://localhost:8080"
	}
	return base
}
