package notification

import (
	"fmt"
	"strings"
)

type Slot string

const (
	SlotDaily2100         Slot = "daily_2100"
	SlotWeeklyPrevSat1900 Slot = "weekly_prev_sat_1900"
	SlotWeeklyDueSun1000  Slot = "weekly_due_sun_1000"
)

func ParseSlot(raw string) (Slot, error) {
	switch slot := Slot(strings.TrimSpace(raw)); slot {
	case SlotDaily2100, SlotWeeklyPrevSat1900, SlotWeeklyDueSun1000:
		return slot, nil
	default:
		return "", fmt.Errorf("unsupported notify slot: %s", raw)
	}
}
