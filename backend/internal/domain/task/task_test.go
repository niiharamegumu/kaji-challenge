package task

import (
	"testing"
	"time"
)

func TestNormalizeRequiredCompletionsPerWeek(t *testing.T) {
	if got, err := NormalizeRequiredCompletionsPerWeek(TypeDaily, 7); err != nil || got != 1 {
		t.Fatalf("daily required = (%d, %v), want (1, nil)", got, err)
	}
	if got, err := NormalizeRequiredCompletionsPerWeek(TypeWeekly, 3); err != nil || got != 3 {
		t.Fatalf("weekly required = (%d, %v), want (3, nil)", got, err)
	}
	if _, err := NormalizeRequiredCompletionsPerWeek(TypeWeekly, 8); err == nil {
		t.Fatal("expected out-of-range weekly required to fail")
	}
}

func TestValidateDailyAction(t *testing.T) {
	today := time.Date(2026, 3, 10, 0, 0, 0, 0, time.UTC)
	if err := ValidateDailyAction(today, today, ActionToggle); err != nil {
		t.Fatalf("today toggle failed: %v", err)
	}
	if err := ValidateDailyAction(today, today, ActionComplete); err == nil {
		t.Fatal("expected today complete to fail")
	}
	past := today.AddDate(0, 0, -1)
	if err := ValidateDailyAction(past, today, ActionComplete); err != nil {
		t.Fatalf("past current month complete failed: %v", err)
	}
	if err := ValidateDailyAction(past, today, ActionDecrement); err != nil {
		t.Fatalf("past current month decrement failed: %v", err)
	}
	if err := ValidateDailyAction(today.AddDate(0, -2, 0), today, ActionComplete); err != nil {
		t.Fatalf("past month complete failed: %v", err)
	}
}

func TestNextWeeklyCompletionCount(t *testing.T) {
	tests := []struct {
		name       string
		current    int64
		required   int
		action     CompletionAction
		wantNext   int64
		wantMutate bool
		wantErr    bool
	}{
		{name: "single toggles on", current: 0, required: 1, action: ActionToggle, wantNext: 1, wantMutate: true},
		{name: "single toggles off", current: 1, required: 1, action: ActionToggle, wantNext: 0, wantMutate: true},
		{name: "single increments", current: 0, required: 1, action: ActionIncrement, wantNext: 1, wantMutate: true},
		{name: "single increment caps", current: 1, required: 1, action: ActionIncrement, wantNext: 1},
		{name: "single decrements", current: 1, required: 1, action: ActionDecrement, wantMutate: true},
		{name: "multi increments", current: 1, required: 3, action: ActionIncrement, wantNext: 2, wantMutate: true},
		{name: "multi caps", current: 3, required: 3, action: ActionIncrement, wantNext: 3},
		{name: "multi decrements", current: 2, required: 3, action: ActionDecrement, wantNext: 1, wantMutate: true},
		{name: "multi decrement empty", current: 0, required: 3, action: ActionDecrement, wantNext: 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotNext, gotMutate, err := NextWeeklyCompletionCount(tt.current, tt.required, tt.action)
			if (err != nil) != tt.wantErr {
				t.Fatalf("NextWeeklyCompletionCount error = %v, wantErr %v", err, tt.wantErr)
			}
			if gotNext != tt.wantNext || gotMutate != tt.wantMutate {
				t.Fatalf("NextWeeklyCompletionCount() = (%d, %v), want (%d, %v)", gotNext, gotMutate, tt.wantNext, tt.wantMutate)
			}
		})
	}
}

func TestValidateWeeklyAction(t *testing.T) {
	loc := time.FixedZone("JST", 9*60*60)
	today := time.Date(2026, 3, 17, 0, 0, 0, 0, loc)
	currentWeekStart := time.Date(2026, 3, 16, 0, 0, 0, 0, loc)
	pastWeekStart := time.Date(2026, 3, 9, 0, 0, 0, 0, loc)

	tests := []struct {
		name      string
		weekStart time.Time
		weekEnd   time.Time
		action    CompletionAction
		wantPast  bool
		wantErr   bool
	}{
		{name: "current week allows toggle", weekStart: currentWeekStart, weekEnd: currentWeekStart.AddDate(0, 0, 6), action: ActionToggle},
		{name: "past current month allows increment", weekStart: pastWeekStart, weekEnd: pastWeekStart.AddDate(0, 0, 6), action: ActionIncrement, wantPast: true},
		{name: "past current month allows decrement", weekStart: pastWeekStart, weekEnd: pastWeekStart.AddDate(0, 0, 6), action: ActionDecrement, wantPast: true},
		{name: "past current month rejects toggle", weekStart: pastWeekStart, weekEnd: pastWeekStart.AddDate(0, 0, 6), action: ActionToggle, wantErr: true},
		{name: "past previous month allowed", weekStart: time.Date(2026, 2, 16, 0, 0, 0, 0, loc), weekEnd: time.Date(2026, 2, 22, 0, 0, 0, 0, loc), action: ActionIncrement, wantPast: true},
		{name: "future week rejected", weekStart: time.Date(2026, 3, 23, 0, 0, 0, 0, loc), weekEnd: time.Date(2026, 3, 29, 0, 0, 0, 0, loc), action: ActionIncrement, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotPast, err := ValidateWeeklyAction(tt.weekStart, today, tt.weekStart, tt.weekEnd, tt.action)
			if (err != nil) != tt.wantErr || gotPast != tt.wantPast {
				t.Fatalf("ValidateWeeklyAction() = (%v, %v), want (%v, err=%v)", gotPast, err, tt.wantPast, tt.wantErr)
			}
		})
	}
}
