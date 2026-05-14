package team

import "testing"

func TestNormalizeNameAndDefaultOwnTeamName(t *testing.T) {
	got, err := NormalizeName("  Home Team  ")
	if err != nil || got != "Home Team" {
		t.Fatalf("NormalizeName = %q, %v", got, err)
	}
	if _, err := NormalizeName("   "); err == nil {
		t.Fatal("expected empty team name to fail")
	}
	if got := DefaultOwnTeamName(" Alice "); got != "Alice Team" {
		t.Fatalf("DefaultOwnTeamName = %q", got)
	}
}
