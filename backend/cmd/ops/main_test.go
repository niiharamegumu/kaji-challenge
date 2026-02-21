package main

import (
	"bytes"
	"context"
	"errors"
	"log"
	"strings"
	"testing"
	"time"

	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

type fakeCloseRunner struct {
	list []string

	listErr error

	dayErrByTeam   map[string]error
	weekErrByTeam  map[string]error
	monthErrByTeam map[string]error

	closedTeams []string
}

func (f *fakeCloseRunner) ListClosableTeamIDs(context.Context) ([]string, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	return append([]string{}, f.list...), nil
}

func (f *fakeCloseRunner) CloseDayForTeam(_ context.Context, teamID string) (api.CloseResponse, error) {
	f.closedTeams = append(f.closedTeams, "day:"+teamID)
	if err := f.dayErrByTeam[teamID]; err != nil {
		return api.CloseResponse{}, err
	}
	return okResp(), nil
}

func (f *fakeCloseRunner) CloseWeekForTeam(_ context.Context, teamID string) (api.CloseResponse, error) {
	f.closedTeams = append(f.closedTeams, "week:"+teamID)
	if err := f.weekErrByTeam[teamID]; err != nil {
		return api.CloseResponse{}, err
	}
	return okResp(), nil
}

func (f *fakeCloseRunner) CloseMonthForTeam(_ context.Context, teamID string) (api.CloseResponse, error) {
	f.closedTeams = append(f.closedTeams, "month:"+teamID)
	if err := f.monthErrByTeam[teamID]; err != nil {
		return api.CloseResponse{}, err
	}
	return okResp(), nil
}

func okResp() api.CloseResponse {
	return api.CloseResponse{
		Month:    "2026-02",
		ClosedAt: time.Date(2026, 2, 21, 12, 0, 0, 0, time.UTC),
	}
}

func TestRunRejectsInvalidScope(t *testing.T) {
	runner := &fakeCloseRunner{}
	var out bytes.Buffer
	logger := log.New(&out, "", 0)

	code := run([]string{"close", "--scope=bad", "--all-teams"}, logger, runner)
	if code != 1 {
		t.Fatalf("expected exit code 1, got %d", code)
	}
	if !strings.Contains(out.String(), "invalid --scope") {
		t.Fatalf("expected invalid scope log, got: %s", out.String())
	}
}

func TestRunAllTeamsSuccess(t *testing.T) {
	runner := &fakeCloseRunner{
		list:         []string{"team-1", "team-2"},
		dayErrByTeam: map[string]error{},
	}
	var out bytes.Buffer
	logger := log.New(&out, "", 0)

	code := run([]string{"close", "--scope=day", "--all-teams"}, logger, runner)
	if code != 0 {
		t.Fatalf("expected exit code 0, got %d", code)
	}
	if got := strings.Join(runner.closedTeams, ","); got != "day:team-1,day:team-2" {
		t.Fatalf("unexpected closed teams: %s", got)
	}
	if !strings.Contains(out.String(), "processed=2 succeeded=2 failed=0") {
		t.Fatalf("missing summary log: %s", out.String())
	}
}

func TestRunAllTeamsContinuesOnFailure(t *testing.T) {
	runner := &fakeCloseRunner{
		list:          []string{"team-1", "team-2"},
		weekErrByTeam: map[string]error{"team-1": errors.New("boom")},
	}
	var out bytes.Buffer
	logger := log.New(&out, "", 0)

	code := run([]string{"close", "--scope=week", "--all-teams"}, logger, runner)
	if code != 1 {
		t.Fatalf("expected exit code 1, got %d", code)
	}
	if got := strings.Join(runner.closedTeams, ","); got != "week:team-1,week:team-2" {
		t.Fatalf("expected processing to continue after failure, got: %s", got)
	}
	if !strings.Contains(out.String(), "processed=2 succeeded=1 failed=1") {
		t.Fatalf("missing failure summary log: %s", out.String())
	}
}

func TestRunTeamIDOnly(t *testing.T) {
	runner := &fakeCloseRunner{
		monthErrByTeam: map[string]error{},
	}
	var out bytes.Buffer
	logger := log.New(&out, "", 0)

	code := run([]string{"close", "--scope=month", "--team-id=team-9", "--all-teams=false"}, logger, runner)
	if code != 0 {
		t.Fatalf("expected exit code 0, got %d", code)
	}
	if got := strings.Join(runner.closedTeams, ","); got != "month:team-9" {
		t.Fatalf("unexpected closed team calls: %s", got)
	}
}

func TestRunRejectsMissingSubcommand(t *testing.T) {
	runner := &fakeCloseRunner{}
	var out bytes.Buffer
	logger := log.New(&out, "", 0)

	code := run([]string{}, logger, runner)
	if code != 1 {
		t.Fatalf("expected exit code 1, got %d", code)
	}
	if !strings.Contains(out.String(), "missing subcommand") {
		t.Fatalf("expected missing subcommand log, got: %s", out.String())
	}
}

func TestRunRejectsUnsupportedSubcommand(t *testing.T) {
	runner := &fakeCloseRunner{}
	var out bytes.Buffer
	logger := log.New(&out, "", 0)

	code := run([]string{"sync"}, logger, runner)
	if code != 1 {
		t.Fatalf("expected exit code 1, got %d", code)
	}
	if !strings.Contains(out.String(), "unsupported subcommand") {
		t.Fatalf("expected unsupported subcommand log, got: %s", out.String())
	}
}
