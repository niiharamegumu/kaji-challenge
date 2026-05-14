package reminder

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
		{name: "create trims", fn: NormalizeTitle, input: "  reminder  ", want: "reminder"},
		{name: "create rejects empty", fn: NormalizeTitle, input: "   ", wantErr: true},
		{name: "patch trims", fn: NormalizePatchTitle, input: "  reminder  ", want: "reminder"},
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

func TestExpandOccurrencesDailyWeeklyMonthlyAndBounds(t *testing.T) {
	loc := time.FixedZone("JST", 9*60*60)
	daily := ScheduleDaily
	weekly := ScheduleWeekly
	monthly := ScheduleMonthly
	end := time.Date(2026, 5, 15, 0, 0, 0, 0, loc)

	for _, tt := range []struct {
		name string
		rec  Reminder
		from time.Time
		to   time.Time
		want []string
	}{
		{
			name: "one time in range",
			rec:  Reminder{ID: "one", Title: "one", Kind: KindOneTime, StartDate: time.Date(2026, 5, 13, 0, 0, 0, 0, loc)},
			from: time.Date(2026, 5, 1, 0, 0, 0, 0, loc), to: time.Date(2026, 5, 31, 0, 0, 0, 0, loc),
			want: []string{"2026-05-13"},
		},
		{
			name: "daily capped by end",
			rec:  Reminder{ID: "daily", Title: "daily", Kind: KindRecurring, ScheduleType: &daily, StartDate: time.Date(2026, 5, 13, 0, 0, 0, 0, loc), EndDate: &end},
			from: time.Date(2026, 5, 12, 0, 0, 0, 0, loc), to: time.Date(2026, 5, 20, 0, 0, 0, 0, loc),
			want: []string{"2026-05-13", "2026-05-14", "2026-05-15"},
		},
		{
			name: "weekly aligns weekday",
			rec:  Reminder{ID: "weekly", Title: "weekly", Kind: KindRecurring, ScheduleType: &weekly, StartDate: time.Date(2026, 5, 6, 0, 0, 0, 0, loc)},
			from: time.Date(2026, 5, 7, 0, 0, 0, 0, loc), to: time.Date(2026, 5, 21, 0, 0, 0, 0, loc),
			want: []string{"2026-05-13", "2026-05-20"},
		},
		{
			name: "monthly skips short month",
			rec:  Reminder{ID: "monthly", Title: "monthly", Kind: KindRecurring, ScheduleType: &monthly, StartDate: time.Date(2026, 1, 31, 0, 0, 0, 0, loc)},
			from: time.Date(2026, 2, 1, 0, 0, 0, 0, loc), to: time.Date(2026, 4, 30, 0, 0, 0, 0, loc),
			want: []string{"2026-03-31"},
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := ExpandOccurrences(tt.rec, tt.from, tt.to)
			if len(got) != len(tt.want) {
				t.Fatalf("got %d occurrences %+v, want %d", len(got), got, len(tt.want))
			}
			for i := range got {
				if got[i].Date.Format(time.DateOnly) != tt.want[i] {
					t.Fatalf("occurrence[%d] = %s, want %s", i, got[i].Date.Format(time.DateOnly), tt.want[i])
				}
			}
		})
	}
}
