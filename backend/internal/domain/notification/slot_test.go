package notification

import "testing"

func TestParseSlot(t *testing.T) {
	got, err := ParseSlot(" daily_2100 ")
	if err != nil || got != SlotDaily2100 {
		t.Fatalf("ParseSlot() = (%q, %v), want (%q, nil)", got, err, SlotDaily2100)
	}
	if _, err := ParseSlot("unknown"); err == nil {
		t.Fatal("expected unknown slot to fail")
	}
}
