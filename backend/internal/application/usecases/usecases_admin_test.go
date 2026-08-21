package usecases

import (
	"context"
	"testing"
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
)

type fakeAdminRepository struct {
	now time.Time

	primaryTeamID string
	casCalls      int
	casHints      map[string]string
	candidate     model.MonthCloseCandidateResponse
	monthClosed   bool
	finalized     []string

	nextDayTarget   time.Time
	nextDayOK       bool
	closedDayDates  []time.Time
	nextWeekTarget  time.Time
	nextWeekOK      bool
	closedWeekDates []time.Time
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

func (f *fakeAdminRepository) GetMonthCloseCandidate(context.Context, string) (model.MonthCloseCandidateResponse, error) {
	return f.candidate, nil
}

func (f *fakeAdminRepository) IsMonthClosed(context.Context, string, string) (bool, error) {
	return f.monthClosed, nil
}

func (f *fakeAdminRepository) FinalizeMonth(_ context.Context, _ string, month string) error {
	f.finalized = append(f.finalized, month)
	return nil
}

func (f *fakeAdminRepository) NextDayCloseTarget(context.Context, string) (time.Time, bool, error) {
	return f.nextDayTarget, f.nextDayOK, nil
}

func (f *fakeAdminRepository) NextWeekCloseTarget(context.Context, string) (time.Time, bool, error) {
	return f.nextWeekTarget, f.nextWeekOK, nil
}

func (f *fakeAdminRepository) CloseDayTarget(_ context.Context, _ string, target time.Time) (bool, error) {
	f.closedDayDates = append(f.closedDayDates, target)
	return true, nil
}

func (f *fakeAdminRepository) CloseWeekTarget(_ context.Context, _ string, target time.Time) (bool, error) {
	f.closedWeekDates = append(f.closedWeekDates, target)
	return true, nil
}

func (f *fakeAdminRepository) Now() time.Time {
	return f.now
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

func TestAdminCloseMonthForUserTargetClosesOldestCandidate(t *testing.T) {
	loc := time.FixedZone("JST", 9*60*60)
	repo := &fakeAdminRepository{
		now:           time.Date(2026, 3, 1, 9, 0, 0, 0, loc),
		primaryTeamID: "team-1",
		candidate: model.MonthCloseCandidateResponse{Candidate: &model.MonthCloseCandidate{
			Month: "2026-02",
		}},
	}
	uc := adminUsecase{repo: repo}

	res, err := uc.CloseMonthForUserTarget(context.Background(), "user-1", "2026-02")
	if err != nil {
		t.Fatalf("CloseMonthForUserTarget failed: %v", err)
	}
	if repo.casCalls != 1 || len(repo.finalized) != 1 || repo.finalized[0] != "2026-02" {
		t.Fatalf("expected one atomic finalize, cas=%d finalized=%v", repo.casCalls, repo.finalized)
	}
	if res.Month != "2026-02" {
		t.Fatalf("expected response month 2026-02, got %s", res.Month)
	}
}

func TestAdminCloseMonthForUserTargetRejectsCurrentMonth(t *testing.T) {
	loc := time.FixedZone("JST", 9*60*60)
	repo := &fakeAdminRepository{now: time.Date(2026, 3, 1, 9, 0, 0, 0, loc), primaryTeamID: "team-1"}
	uc := adminUsecase{repo: repo}

	if _, err := uc.CloseMonthForUserTarget(context.Background(), "user-1", "2026-03"); err == nil {
		t.Fatal("expected current month close to be rejected")
	}
}
