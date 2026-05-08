package shopping

import "testing"

func TestNormalizeItemName(t *testing.T) {
	got, err := NormalizeItemName("  牛乳  ")
	if err != nil || got != "牛乳" {
		t.Fatalf("NormalizeItemName() = (%q, %v), want (牛乳, nil)", got, err)
	}
	if _, err := NormalizeItemName("   "); err == nil {
		t.Fatal("expected empty name to fail")
	}
}

func TestNormalizePatchItemName(t *testing.T) {
	got, err := NormalizePatchItemName("  卵  ")
	if err != nil || got != "卵" {
		t.Fatalf("NormalizePatchItemName() = (%q, %v), want (卵, nil)", got, err)
	}
	if _, err := NormalizePatchItemName("   "); err == nil {
		t.Fatal("expected empty patch name to fail")
	}
}
