package sortkey

import "testing"

func TestForIndex(t *testing.T) {
	got, err := ForIndex(3)
	if err != nil {
		t.Fatalf("ForIndex failed: %v", err)
	}
	if got != 400 {
		t.Fatalf("ForIndex(3) = %d, want 400", got)
	}
}
