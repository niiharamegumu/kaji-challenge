package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/megu/kaji-challenge/backend/internal/http/infra"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

type closeRunner interface {
	ListClosableTeamIDs(ctx context.Context) ([]string, error)
	CloseDayForTeam(ctx context.Context, teamID string) (api.CloseResponse, error)
	CloseWeekForTeam(ctx context.Context, teamID string) (api.CloseResponse, error)
	CloseMonthForTeam(ctx context.Context, teamID string) (api.CloseResponse, error)
}

func main() {
	logger := log.New(os.Stdout, "", log.LstdFlags)
	store := infra.NewStore()
	os.Exit(run(os.Args[1:], logger, store))
}

func run(args []string, logger *log.Logger, runner closeRunner) int {
	if len(args) == 0 {
		logger.Printf("missing subcommand (expected: close)")
		return 1
	}
	switch args[0] {
	case "close":
		return runClose(args[1:], logger, runner)
	default:
		logger.Printf("unsupported subcommand %q (expected: close)", args[0])
		return 1
	}
}

func runClose(args []string, logger *log.Logger, runner closeRunner) int {
	fs := flag.NewFlagSet("ops close", flag.ContinueOnError)
	fs.SetOutput(logger.Writer())

	scope := fs.String("scope", "", "close scope: day|week|month")
	allTeams := fs.Bool("all-teams", true, "run close for all teams")
	teamID := fs.String("team-id", "", "target team id (optional)")

	if err := fs.Parse(args); err != nil {
		logger.Printf("failed to parse close flags: %v", err)
		return 1
	}
	if *scope != "day" && *scope != "week" && *scope != "month" {
		logger.Printf("invalid --scope %q (expected: day|week|month)", *scope)
		return 1
	}

	targetTeamID := strings.TrimSpace(*teamID)
	ctx := context.Background()
	targets := []string{}
	if targetTeamID != "" {
		targets = append(targets, targetTeamID)
	} else if *allTeams {
		list, err := runner.ListClosableTeamIDs(ctx)
		if err != nil {
			logger.Printf("failed to list closable teams: %v", err)
			return 1
		}
		targets = list
	} else {
		logger.Printf("no target specified: set --all-teams=true or provide --team-id")
		return 1
	}

	logger.Printf("ops close started: scope=%s targets=%d", *scope, len(targets))
	processed := 0
	succeeded := 0
	failed := 0
	for _, id := range targets {
		processed++
		res, err := runScope(ctx, runner, *scope, id)
		if err != nil {
			failed++
			logger.Printf("ops close failed: scope=%s team_id=%s err=%v", *scope, id, err)
			continue
		}
		succeeded++
		logger.Printf(
			"ops close succeeded: scope=%s team_id=%s month=%s closed_at=%s",
			*scope,
			id,
			res.Month,
			res.ClosedAt.Format("2006-01-02T15:04:05-07:00"),
		)
	}
	logger.Printf(
		"ops close finished: scope=%s processed=%d succeeded=%d failed=%d",
		*scope,
		processed,
		succeeded,
		failed,
	)
	if failed > 0 {
		return 1
	}
	return 0
}

func runScope(ctx context.Context, runner closeRunner, scope, teamID string) (api.CloseResponse, error) {
	switch scope {
	case "day":
		return runner.CloseDayForTeam(ctx, teamID)
	case "week":
		return runner.CloseWeekForTeam(ctx, teamID)
	case "month":
		return runner.CloseMonthForTeam(ctx, teamID)
	default:
		return api.CloseResponse{}, fmt.Errorf("unsupported scope: %s", scope)
	}
}
