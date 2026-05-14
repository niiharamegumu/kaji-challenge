package task

import (
	"testing"
	"time"
)

func TestNormalizeTitleAndPatchTitle(t *testing.T) {
	for _, tt := range []struct {
		name    string
		fn      func(string) (string, error)
		input   string
		want    string
		wantErr bool
	}{
		{name: "create trims", fn: NormalizeTitle, input: "  task  ", want: "task"},
		{name: "create rejects empty", fn: NormalizeTitle, input: "   ", wantErr: true},
		{name: "patch trims", fn: NormalizePatchTitle, input: "  task  ", want: "task"},
		{name: "patch rejects empty", fn: NormalizePatchTitle, input: "   ", wantErr: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.fn(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil || got != tt.want {
				t.Fatalf("got %q, %v; want %q", got, err, tt.want)
			}
		})
	}
}

func TestNormalizeCompletionActionAndValidateWeeklyTarget(t *testing.T) {
	inc := ActionIncrement
	if got := NormalizeCompletionAction(nil); got != ActionToggle {
		t.Fatalf("nil action = %s", got)
	}
	if got := NormalizeCompletionAction(&inc); got != ActionIncrement {
		t.Fatalf("explicit action = %s", got)
	}

	loc := time.FixedZone("JST", 9*60*60)
	weekStart := time.Date(2026, 5, 11, 0, 0, 0, 0, loc)
	weekEnd := time.Date(2026, 5, 17, 0, 0, 0, 0, loc)
	if err := ValidateWeeklyTarget(time.Date(2026, 5, 13, 0, 0, 0, 0, loc), weekEnd, weekStart, weekEnd); err != nil {
		t.Fatalf("expected target in week to pass: %v", err)
	}
	if err := ValidateWeeklyTarget(time.Date(2026, 5, 18, 0, 0, 0, 0, loc), weekEnd, weekStart, weekEnd); err == nil {
		t.Fatal("expected target outside week to fail")
	}
}
