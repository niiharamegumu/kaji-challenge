package usecases

import (
	"context"
	"errors"
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
)

var errNoCloseStateChange = errors.New("no_state_change")

func (u taskOverviewUsecase) GetTaskOverview(ctx context.Context, userID string) (model.TaskOverviewResponse, error) {
	return u.repo.GetTaskOverview(ctx, userID)
}

func (u taskOverviewUsecase) GetMonthlySummary(ctx context.Context, userID string, month *string) (model.MonthlyPenaltySummary, error) {
	return u.repo.GetMonthlySummary(ctx, userID, month)
}

func (u adminUsecase) ListClosableTeamIDs(ctx context.Context) ([]string, error) {
	return u.repo.ListClosableTeamIDs(ctx)
}

func (u adminUsecase) CloseDayForUser(ctx context.Context, userID string) (model.CloseResponse, error) {
	teamID, err := u.repo.PrimaryTeamID(ctx, userID)
	if err != nil {
		return model.CloseResponse{}, err
	}
	return u.closeDay(ctx, teamID, true)
}

func (u adminUsecase) CloseWeekForUser(ctx context.Context, userID string) (model.CloseResponse, error) {
	teamID, err := u.repo.PrimaryTeamID(ctx, userID)
	if err != nil {
		return model.CloseResponse{}, err
	}
	return u.closeWeek(ctx, teamID, true)
}

func (u adminUsecase) CloseMonthForUser(ctx context.Context, userID string) (model.CloseResponse, error) {
	teamID, err := u.repo.PrimaryTeamID(ctx, userID)
	if err != nil {
		return model.CloseResponse{}, err
	}
	return u.closeMonth(ctx, teamID, true)
}

func (u adminUsecase) CloseDayForTeam(ctx context.Context, teamID string) (model.CloseResponse, error) {
	return u.closeDay(ctx, teamID, false)
}

func (u adminUsecase) CloseWeekForTeam(ctx context.Context, teamID string) (model.CloseResponse, error) {
	return u.closeWeek(ctx, teamID, false)
}

func (u adminUsecase) CloseMonthForTeam(ctx context.Context, teamID string) (model.CloseResponse, error) {
	return u.closeMonth(ctx, teamID, false)
}

func (u adminUsecase) closeDay(ctx context.Context, teamID string, useCAS bool) (model.CloseResponse, error) {
	now := u.repo.Now()
	run := func(runCtx context.Context) error {
		processed, err := u.catchUpDay(runCtx, now, teamID)
		if err != nil {
			return err
		}
		if processed == 0 && useCAS {
			return errNoCloseStateChange
		}
		return nil
	}
	if err := u.runClose(ctx, teamID, "close_run", map[string]string{"scope": "day"}, useCAS, run); err != nil {
		return model.CloseResponse{}, err
	}
	return model.CloseResponse{ClosedAt: now, Month: monthKeyFromTime(now)}, nil
}

func (u adminUsecase) closeWeek(ctx context.Context, teamID string, useCAS bool) (model.CloseResponse, error) {
	now := u.repo.Now()
	run := func(runCtx context.Context) error {
		processed, err := u.catchUpWeek(runCtx, now, teamID)
		if err != nil {
			return err
		}
		if processed == 0 && useCAS {
			return errNoCloseStateChange
		}
		return nil
	}
	if err := u.runClose(ctx, teamID, "close_run", map[string]string{"scope": "week"}, useCAS, run); err != nil {
		return model.CloseResponse{}, err
	}
	return model.CloseResponse{ClosedAt: now, Month: monthKeyFromTime(now)}, nil
}

func (u adminUsecase) closeMonth(ctx context.Context, teamID string, useCAS bool) (model.CloseResponse, error) {
	now := u.repo.Now()
	closedMonth := monthKeyFromTime(now)
	run := func(runCtx context.Context) error {
		processed, month, err := u.catchUpMonth(runCtx, now, teamID)
		if err != nil {
			return err
		}
		closedMonth = month
		if processed == 0 && useCAS {
			return errNoCloseStateChange
		}
		return nil
	}
	if err := u.runClose(ctx, teamID, "close_run", map[string]string{"scope": "month"}, useCAS, run); err != nil {
		return model.CloseResponse{}, err
	}
	return model.CloseResponse{ClosedAt: now, Month: closedMonth}, nil
}

func (u adminUsecase) runClose(
	ctx context.Context,
	teamID string,
	entity string,
	hints map[string]string,
	useCAS bool,
	fn func(context.Context) error,
) error {
	if !useCAS {
		return fn(ctx)
	}
	return u.repo.RunTeamRevisionCAS(ctx, teamID, entity, hints, fn)
}

func (u adminUsecase) catchUpDay(ctx context.Context, now time.Time, teamID string) (int, error) {
	end := dateOnly(now).AddDate(0, 0, -1)
	start, ok, err := u.repo.NextDayCloseTarget(ctx, teamID)
	if err != nil {
		return 0, err
	}
	if !ok || start.After(end) {
		return 0, nil
	}
	processed := 0
	for target := start; !target.After(end); target = target.AddDate(0, 0, 1) {
		didRun, err := u.repo.CloseDayTarget(ctx, teamID, target)
		if err != nil {
			return processed, err
		}
		if didRun {
			processed++
		}
	}
	return processed, nil
}

func (u adminUsecase) catchUpWeek(ctx context.Context, now time.Time, teamID string) (int, error) {
	thisWeekStart := startOfWeek(dateOnly(now), now.Location())
	end := thisWeekStart.AddDate(0, 0, -7)
	start, ok, err := u.repo.NextWeekCloseTarget(ctx, teamID)
	if err != nil {
		return 0, err
	}
	if !ok || start.After(end) {
		return 0, nil
	}
	processed := 0
	for target := start; !target.After(end); target = target.AddDate(0, 0, 7) {
		didRun, err := u.repo.CloseWeekTarget(ctx, teamID, target)
		if err != nil {
			return processed, err
		}
		if didRun {
			processed++
		}
	}
	return processed, nil
}

func (u adminUsecase) catchUpMonth(ctx context.Context, now time.Time, teamID string) (int, string, error) {
	monthStartCurrent := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	end := monthStartCurrent.AddDate(0, -1, 0)
	start, ok, err := u.repo.NextMonthCloseTarget(ctx, teamID)
	if err != nil {
		return 0, "", err
	}
	lastMonth := monthKeyFromTime(end)
	if !ok || start.After(end) {
		return 0, lastMonth, nil
	}
	processed := 0
	for target := start; !target.After(end); target = target.AddDate(0, 1, 0) {
		didRun, month, err := u.repo.CloseMonthTarget(ctx, teamID, target)
		if err != nil {
			return processed, "", err
		}
		lastMonth = month
		if didRun {
			processed++
		}
	}
	return processed, lastMonth, nil
}

func monthKeyFromTime(t time.Time) string {
	return t.In(t.Location()).Format("2006-01")
}
