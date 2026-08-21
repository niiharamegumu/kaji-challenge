package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"

	pushsvc "github.com/megu/kaji-challenge/backend/internal/adapter/external/push"
	"github.com/megu/kaji-challenge/backend/internal/adapter/persistence/postgres"
	"github.com/megu/kaji-challenge/backend/internal/application/model"
	"github.com/megu/kaji-challenge/backend/internal/application/ports"
	"github.com/megu/kaji-challenge/backend/internal/domain/notification"
)

type closeRunner interface {
	ListClosableTeamIDs(ctx context.Context) ([]string, error)
	CloseDayForTeam(ctx context.Context, teamID string) (model.CloseResponse, error)
	CloseWeekForTeam(ctx context.Context, teamID string) (model.CloseResponse, error)
}

type notifyRunner interface {
	NotifySlot(ctx context.Context, slot string, sender ports.PushSender) (ports.NotifyRunResult, error)
}

func main() {
	logger := log.New(os.Stdout, "", log.LstdFlags)
	store := postgres.NewStore()
	services := postgres.NewServices(store)
	os.Exit(run(os.Args[1:], logger, services.Admin, services.Push))
}

func run(args []string, logger *log.Logger, closer closeRunner, notifier notifyRunner) int {
	if len(args) == 0 {
		logger.Printf("missing subcommand (expected: close|notify)")
		return 1
	}
	switch args[0] {
	case "close":
		return runClose(args[1:], logger, closer)
	case "notify":
		return runNotify(args[1:], logger, notifier)
	default:
		logger.Printf("unsupported subcommand %q (expected: close|notify)", args[0])
		return 1
	}
}

func runClose(args []string, logger *log.Logger, runner closeRunner) int {
	fs := flag.NewFlagSet("ops close", flag.ContinueOnError)
	fs.SetOutput(logger.Writer())

	scope := fs.String("scope", "", "close scope: day|week")
	allTeams := fs.Bool("all-teams", true, "run close for all teams")
	teamID := fs.String("team-id", "", "target team id (optional)")

	if err := fs.Parse(args); err != nil {
		logger.Printf("failed to parse close flags: %v", err)
		return 1
	}
	if *scope != "day" && *scope != "week" {
		logger.Printf("invalid --scope %q (expected: day|week)", *scope)
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
	logger.Printf("ops close catch-up mode: pending periods are processed continuously")
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

func runScope(ctx context.Context, runner closeRunner, scope, teamID string) (model.CloseResponse, error) {
	switch scope {
	case "day":
		return runner.CloseDayForTeam(ctx, teamID)
	case "week":
		return runner.CloseWeekForTeam(ctx, teamID)
	default:
		return model.CloseResponse{}, fmt.Errorf("unsupported scope: %s", scope)
	}
}

func runNotify(args []string, logger *log.Logger, runner notifyRunner) int {
	fs := flag.NewFlagSet("ops notify", flag.ContinueOnError)
	fs.SetOutput(logger.Writer())

	slot := fs.String("slot", "", "notify slot: daily_2100|weekly_prev_sat_1900|weekly_due_sun_1000")

	if err := fs.Parse(args); err != nil {
		logger.Printf("failed to parse notify flags: %v", err)
		return 1
	}
	parsedSlot, err := notification.ParseSlot(*slot)
	if err != nil {
		logger.Printf("invalid --slot %q: %v", *slot, err)
		return 1
	}
	sender, err := pushsvc.NewWebPushSenderFromEnv()
	if err != nil {
		logger.Printf("failed to initialize web push sender: %v", err)
		return 1
	}
	parsedSlotString := string(parsedSlot)
	logger.Printf("ops notify started: slot=%s", parsedSlotString)
	result, err := runner.NotifySlot(context.Background(), parsedSlotString, pushsvc.AsPortsSender(sender))
	logger.Printf(
		"ops notify finished: slot=%s processed=%d sent=%d skipped=%d failed=%d",
		parsedSlotString,
		result.Processed,
		result.Sent,
		result.Skipped,
		result.Failed,
	)
	if err != nil || result.Failed > 0 {
		if err != nil {
			logger.Printf("ops notify failed: slot=%s err=%v", parsedSlotString, err)
		}
		return 1
	}
	return 0
}
