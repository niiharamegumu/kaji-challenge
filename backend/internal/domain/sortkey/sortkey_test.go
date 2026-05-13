package sortkey

import (
	"math"
	"testing"
)

func TestPrepend(t *testing.T) {
	tests := []struct {
		name    string
		first   int32
		wantKey int32
		wantGap bool
	}{
		{name: "empty list", first: 0, wantKey: Step, wantGap: true},
		{name: "has gap", first: 80, wantKey: 40, wantGap: true},
		{name: "no gap", first: 1, wantKey: Step, wantGap: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotKey, gotGap := Prepend(tt.first)
			if gotKey != tt.wantKey || gotGap != tt.wantGap {
				t.Fatalf("Prepend(%d) = (%d, %v), want (%d, %v)", tt.first, gotKey, gotGap, tt.wantKey, tt.wantGap)
			}
		})
	}
}

func TestFindMovedID(t *testing.T) {
	tests := []struct {
		name      string
		current   []string
		requested []string
		want      string
	}{
		{name: "unchanged", current: []string{"a", "b", "c"}, requested: []string{"a", "b", "c"}, want: ""},
		{name: "single moved", current: []string{"a", "b", "c"}, requested: []string{"b", "a", "c"}, want: "b"},
		{name: "multiple changed", current: []string{"a", "b", "c"}, requested: []string{"c", "a", "b"}, want: "c"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := FindMovedID(tt.current, tt.requested); got != tt.want {
				t.Fatalf("FindMovedID() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestMovedItemSortKey(t *testing.T) {
	tests := []struct {
		name      string
		requested []string
		keys      map[string]int32
		movedID   string
		wantKey   int32
		wantOK    bool
	}{
		{
			name:      "move to first gap",
			requested: []string{"b", "a", "c"},
			keys:      map[string]int32{"a": 100, "b": 200, "c": 300},
			movedID:   "b",
			wantKey:   50,
			wantOK:    true,
		},
		{
			name:      "move to last gap",
			requested: []string{"a", "c", "b"},
			keys:      map[string]int32{"a": 100, "b": 200, "c": 300},
			movedID:   "b",
			wantKey:   400,
			wantOK:    true,
		},
		{
			name:      "move between gap",
			requested: []string{"a", "c", "b"},
			keys:      map[string]int32{"a": 100, "b": 300, "c": 200},
			movedID:   "c",
			wantKey:   200,
			wantOK:    true,
		},
		{
			name:      "no gap",
			requested: []string{"b", "a"},
			keys:      map[string]int32{"a": 1, "b": 2},
			movedID:   "b",
			wantOK:    false,
		},
		{
			name:      "append overflows",
			requested: []string{"a", "b"},
			keys:      map[string]int32{"a": math.MaxInt32 - Step + 1, "b": 100},
			movedID:   "b",
			wantOK:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotKey, gotOK, err := MovedItemSortKey(tt.requested, tt.keys, tt.movedID)
			if err != nil {
				t.Fatalf("MovedItemSortKey returned error: %v", err)
			}
			if gotKey != tt.wantKey || gotOK != tt.wantOK {
				t.Fatalf("MovedItemSortKey() = (%d, %v), want (%d, %v)", gotKey, gotOK, tt.wantKey, tt.wantOK)
			}
		})
	}
}
