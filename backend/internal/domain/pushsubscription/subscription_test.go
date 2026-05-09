package pushsubscription

import "testing"

func TestNormalize(t *testing.T) {
	got, err := Normalize(" https://example.com ", " key ", " auth ", PlatformIOSSafariPWA)
	if err != nil {
		t.Fatalf("Normalize failed: %v", err)
	}
	if got.Endpoint != "https://example.com" || got.P256DH != "key" || got.Auth != "auth" {
		t.Fatalf("unexpected normalized subscription: %#v", got)
	}
	if _, err := Normalize("", "key", "auth", PlatformIOSSafariPWA); err == nil {
		t.Fatal("expected empty endpoint to fail")
	}
	if _, err := Normalize("https://example.com", "key", "auth", "web"); err == nil {
		t.Fatal("expected invalid platform to fail")
	}
}
