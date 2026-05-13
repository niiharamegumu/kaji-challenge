package penalty

import "testing"

func TestTriggeredRuleIDs(t *testing.T) {
	rules := []Rule{
		{ID: "low", Threshold: 3},
		{ID: "high", Threshold: 5},
	}
	got := TriggeredRuleIDs(4, rules)
	if len(got) != 1 || got[0] != "low" {
		t.Fatalf("TriggeredRuleIDs() = %#v, want [low]", got)
	}
}

func TestNormalizeRuleName(t *testing.T) {
	if got := NormalizeRuleName("  遅刻  "); got != "遅刻" {
		t.Fatalf("NormalizeRuleName() = %q, want 遅刻", got)
	}
	if got := NormalizeRuleName("   "); got != "" {
		t.Fatalf("NormalizeRuleName() = %q, want empty string", got)
	}
}
