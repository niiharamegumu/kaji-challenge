package usecases

import (
	"context"
	"testing"
	"time"
)

type fakeAdminRepository struct {
	now time.Time

	primaryTeamID string
	casCalls      int
	casHints      map[string]string

	nextDayTarget   time.Time
	nextDayOK       bool
	closedDayDates  []time.Time
	nextWeekTarget  time.Time
	nextWeekOK      bool
	closedWeekDates []time.Time
	nextMonthTarget time.Time
	nextMonthOK     bool
	closedMonths    []time.Time
}

func (f *fakeAdminRepository) ListClosableTeamIDs(context.Context) ([]string, error) {
	return nil, nil
}

func (f *fakeAdminRepository) PrimaryTeamID(context.Context, string) (string, error) {
	return f.primaryTeamID, nil
}

func (f *fakeAdminRepository) RunTeamRevisionCAS(ctx context.Context, _ string, _ string, hints map[string]string, fn func(context.Context) error) error {
	f.casCalls++
	f.casHints = hints
	return fn(ctx)
}

func (f *fakeAdminRepository) NextDayCloseTarget(context.Context, string) (time.Time, bool, error) {
	return f.nextDayTarget, f.nextDayOK, nil
}

func (f *fakeAdminRepository) NextWeekCloseTarget(context.Context, string) (time.Time, bool, error) {
	return f.nextWeekTarget, f.nextWeekOK, nil
}

func (f *fakeAdminRepository) NextMonthCloseTarget(context.Context, string) (time.Time, bool, error) {
	return f.nextMonthTarget, f.nextMonthOK, nil
}

func (f *fakeAdminRepository) CloseDayTarget(_ context.Context, _ string, target time.Time) (bool, error) {
	f.closedDayDates = append(f.closedDayDates, target)
	return true, nil
}

func (f *fakeAdminRepository) CloseWeekTarget(_ context.Context, _ string, target time.Time) (bool, error) {
	f.closedWeekDates = append(f.closedWeekDates, target)
	return true, nil
}

func (f *fakeAdminRepository) CloseMonthTarget(_ context.Context, _ string, target time.Time) (bool, string, error) {
	f.closedMonths = append(f.closedMonths, target)
	return true, monthKeyFromTime(target), nil
}

func (f *fakeAdminRepository) Now() time.Time {
	return f.now
}

func TestAdminCloseDayForUserRunsCASAndProcessesMissingDays(t *testing.T) {
	loc := time.FixedZone("JST", 9*60*60)
	repo := &fakeAdminRepository{
		now:           time.Date(2026, 3, 17, 9, 0, 0, 0, loc),
		primaryTeamID: "team-1",
		nextDayTarget: time.Date(2026, 3, 14, 0, 0, 0, 0, loc),
		nextDayOK:     true,
	}
	uc := adminUsecase{repo: repo}

	res, err := uc.CloseDayForUser(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("CloseDayForUser failed: %v", err)
	}
	if repo.casCalls != 1 {
		t.Fatalf("expected CAS once, got %d", repo.casCalls)
	}
	if repo.casHints["scope"] != "day" {
		t.Fatalf("expected day CAS scope, got %v", repo.casHints)
	}
	if got := len(repo.closedDayDates); got != 3 {
		t.Fatalf("expected 3 day close targets, got %d (%v)", got, repo.closedDayDates)
	}
	if res.Month != "2026-03" {
		t.Fatalf("expected response month 2026-03, got %s", res.Month)
	}
}

func TestAdminCloseWeekForTeamProcessesCompletedWeeksWithoutCAS(t *testing.T) {
	loc := time.FixedZone("JST", 9*60*60)
	repo := &fakeAdminRepository{
		now:            time.Date(2026, 3, 18, 9, 0, 0, 0, loc),
		nextWeekTarget: time.Date(2026, 3, 2, 0, 0, 0, 0, loc),
		nextWeekOK:     true,
	}
	uc := adminUsecase{repo: repo}

	if _, err := uc.CloseWeekForTeam(context.Background(), "team-1"); err != nil {
		t.Fatalf("CloseWeekForTeam failed: %v", err)
	}
	if repo.casCalls != 0 {
		t.Fatalf("expected no CAS for team close, got %d", repo.casCalls)
	}
	if got := len(repo.closedWeekDates); got != 2 {
		t.Fatalf("expected 2 week close targets, got %d (%v)", got, repo.closedWeekDates)
	}
}

func TestAdminCloseMonthForTeamReturnsLastProcessedMonth(t *testing.T) {
	loc := time.FixedZone("JST", 9*60*60)
	repo := &fakeAdminRepository{
		now:             time.Date(2026, 4, 2, 9, 0, 0, 0, loc),
		nextMonthTarget: time.Date(2026, 1, 1, 0, 0, 0, 0, loc),
		nextMonthOK:     true,
	}
	uc := adminUsecase{repo: repo}

	res, err := uc.CloseMonthForTeam(context.Background(), "team-1")
	if err != nil {
		t.Fatalf("CloseMonthForTeam failed: %v", err)
	}
	if got := len(repo.closedMonths); got != 3 {
		t.Fatalf("expected 3 month close targets, got %d (%v)", got, repo.closedMonths)
	}
	if res.Month != "2026-03" {
		t.Fatalf("expected last processed month 2026-03, got %s", res.Month)
	}
}
