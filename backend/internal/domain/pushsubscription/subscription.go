package pushsubscription

import (
	"errors"
	"strings"
)

const PlatformIOSSafariPWA = "ios_safari_pwa" // #nosec G101 -- Push platform identifier, not a credential.

type Subscription struct {
	Endpoint string
	P256DH   string
	Auth     string
	Platform string
}

func Normalize(endpoint, p256dh, auth, platform string) (Subscription, error) {
	sub := Subscription{
		Endpoint: strings.TrimSpace(endpoint),
		P256DH:   strings.TrimSpace(p256dh),
		Auth:     strings.TrimSpace(auth),
		Platform: strings.TrimSpace(platform),
	}
	if sub.Endpoint == "" {
		return Subscription{}, errors.New("endpoint is required")
	}
	if sub.P256DH == "" {
		return Subscription{}, errors.New("keys.p256dh is required")
	}
	if sub.Auth == "" {
		return Subscription{}, errors.New("keys.auth is required")
	}
	if sub.Platform != PlatformIOSSafariPWA {
		return Subscription{}, errors.New("invalid push platform")
	}
	return sub, nil
}
