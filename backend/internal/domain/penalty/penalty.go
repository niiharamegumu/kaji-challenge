package penalty

import "strings"

type Rule struct {
	ID        string
	Threshold int
}

func NormalizeRuleName(raw string) string {
	return strings.TrimSpace(raw)
}

func TriggeredRuleIDs(total int, rules []Rule) []string {
	triggered := make([]string, 0, len(rules))
	for _, rule := range rules {
		if total >= rule.Threshold {
			triggered = append(triggered, rule.ID)
		}
	}
	return triggered
}
