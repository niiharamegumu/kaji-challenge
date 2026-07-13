package task

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

type Type string

const (
	TypeDaily  Type = "daily"
	TypeWeekly Type = "weekly"
)

type CompletionAction string

const (
	ActionComplete  CompletionAction = "complete"
	ActionDecrement CompletionAction = "decrement"
	ActionIncrement CompletionAction = "increment"
	ActionToggle    CompletionAction = "toggle"
)

const (
	RequiredCompletionsPerWeekMin = 1
	RequiredCompletionsPerWeekMax = 7
)

func NormalizeTitle(raw string) (string, error) {
	title := strings.TrimSpace(raw)
	if title == "" {
		return "", errors.New("title is required")
	}
	return title, nil
}

func NormalizePatchTitle(raw string) (string, error) {
	title := strings.TrimSpace(raw)
	if title == "" {
		return "", errors.New("title cannot be empty")
	}
	return title, nil
}

func NormalizeRequiredCompletionsPerWeek(taskType Type, required int) (int, error) {
	if taskType == TypeDaily {
		return RequiredCompletionsPerWeekMin, nil
	}
	if required < RequiredCompletionsPerWeekMin || required > RequiredCompletionsPerWeekMax {
		return 0, fmt.Errorf(
			"required completions per week must be between %d and %d",
			RequiredCompletionsPerWeekMin,
			RequiredCompletionsPerWeekMax,
		)
	}
	return required, nil
}

func NormalizeCompletionAction(action *CompletionAction) CompletionAction {
	if action == nil || *action == "" {
		return ActionToggle
	}
	return *action
}

func ValidateWeeklyTarget(targetDate, today, weekStart, weekEnd time.Time) error {
	if targetDate.Before(weekStart) || targetDate.After(weekEnd) {
		return errors.New("weekly completion can only be toggled within current week")
	}
	return nil
}

func ValidateWeeklyAction(targetDate, today, weekStart, weekEnd time.Time, targetMonth, currentMonth string, monthClosed bool, mode CompletionAction) (bool, error) {
	currentWeekStart := startOfWeek(today)
	if sameDate(weekStart, currentWeekStart) {
		return false, nil
	}
	if !weekEnd.Before(today) {
		return false, errors.New("weekly completion can only be changed for the current week or completed past weeks")
	}
	if targetMonth != currentMonth {
		return false, errors.New("weekly completion can only be incremented for past weeks ending in current month")
	}
	if monthClosed {
		return false, errors.New("weekly completion cannot be changed for closed month")
	}
	if mode != ActionIncrement {
		return false, errors.New("past weekly completion only supports increment action")
	}
	return true, nil
}

func ValidateDailyAction(targetDate, today time.Time, targetMonth, currentMonth string, monthClosed bool, mode CompletionAction) error {
	if sameDate(targetDate, today) {
		if mode != ActionToggle {
			return errors.New("daily tasks only support toggle action for today")
		}
		return nil
	}
	if targetDate.After(today) {
		return errors.New("daily completion cannot be changed for future dates")
	}
	if targetMonth != currentMonth {
		return errors.New("daily completion can only be completed for past days in current month")
	}
	if monthClosed {
		return errors.New("daily completion cannot be changed for closed month")
	}
	if mode != ActionComplete {
		return errors.New("past daily completion only supports complete action")
	}
	return nil
}

func NextWeeklyCompletionCount(currentCount int64, required int, mode CompletionAction) (int64, bool, error) {
	if required <= 1 {
		if mode != ActionToggle && mode != ActionIncrement {
			return currentCount, false, errors.New("weekly tasks with required completions of 1 only support toggle or increment action")
		}
		if currentCount > 0 {
			return currentCount - 1, true, nil
		}
		return 1, true, nil
	}

	switch mode {
	case ActionToggle, ActionIncrement:
		if currentCount >= int64(required) {
			return currentCount, false, nil
		}
		return currentCount + 1, true, nil
	case ActionDecrement:
		if currentCount <= 0 {
			return 0, false, nil
		}
		return currentCount - 1, true, nil
	default:
		return currentCount, false, errors.New("invalid completion action")
	}
}

func sameDate(a, b time.Time) bool {
	return a.Format("2006-01-02") == b.Format("2006-01-02")
}

func startOfWeek(t time.Time) time.Time {
	weekday := int(t.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	return time.Date(t.Year(), t.Month(), t.Day()-weekday+1, 0, 0, 0, 0, t.Location())
}
