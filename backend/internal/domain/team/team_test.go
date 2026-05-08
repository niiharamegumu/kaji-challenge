package team

import "testing"

func TestNormalizeNickname(t *testing.T) {
	if got, err := NormalizeNickname("  めぐ  "); err != nil || got != "めぐ" {
		t.Fatalf("NormalizeNickname() = (%q, %v), want (めぐ, nil)", got, err)
	}
	if got, err := NormalizeNickname("   "); err != nil || got != "" {
		t.Fatalf("empty NormalizeNickname() = (%q, %v), want empty nil", got, err)
	}
}

func TestNormalizeColorHex(t *testing.T) {
	raw := " #a1b2c3 "
	got, err := NormalizeColorHex(&raw)
	if err != nil || got != "#A1B2C3" {
		t.Fatalf("NormalizeColorHex() = (%q, %v), want (#A1B2C3, nil)", got, err)
	}
	invalid := "#GGGGGG"
	if _, err := NormalizeColorHex(&invalid); err == nil {
		t.Fatal("expected invalid color to fail")
	}
}

func TestEffectiveName(t *testing.T) {
	if got := EffectiveName("Display", " Nick "); got != "Nick" {
		t.Fatalf("EffectiveName() = %q, want Nick", got)
	}
	if got := EffectiveName(" Display ", ""); got != "Display" {
		t.Fatalf("EffectiveName() = %q, want Display", got)
	}
	if got := EffectiveName("", ""); got != "User" {
		t.Fatalf("EffectiveName() = %q, want User", got)
	}
}
