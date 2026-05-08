package reminder

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

type Kind string

const (
	KindOneTime   Kind = "one_time"
	KindRecurring Kind = "recurring"
)

type ScheduleType string

const (
	ScheduleDaily   ScheduleType = "daily"
	ScheduleWeekly  ScheduleType = "weekly"
	ScheduleMonthly ScheduleType = "monthly"
)

type Reminder struct {
	ID           string
	Title        string
	Notes        *string
	Kind         Kind
	ScheduleType *ScheduleType
	StartDate    time.Time
	EndDate      *time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type Occurrence struct {
	ReminderID   string
	Date         time.Time
	Title        string
	Notes        *string
	Kind         Kind
	ScheduleType *ScheduleType
}

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

func Validate(record Reminder) error {
	if strings.TrimSpace(record.Title) == "" {
		return errors.New("title is required")
	}
	if record.Kind == KindOneTime {
		if record.ScheduleType != nil {
			return errors.New("one-time reminder cannot have schedule type")
		}
		if record.EndDate != nil {
			return errors.New("one-time reminder cannot have end date")
		}
		return nil
	}
	if record.Kind != KindRecurring {
		return fmt.Errorf("invalid reminder kind: %s", record.Kind)
	}
	if record.ScheduleType == nil {
		return errors.New("recurring reminder requires schedule type")
	}
	switch *record.ScheduleType {
	case ScheduleDaily, ScheduleWeekly, ScheduleMonthly:
	default:
		return fmt.Errorf("invalid reminder schedule type: %s", *record.ScheduleType)
	}
	if record.EndDate != nil && dateOnly(record.EndDate.In(record.StartDate.Location()), record.StartDate.Location()).Before(record.StartDate) {
		return errors.New("end date must be on or after start date")
	}
	return nil
}

func ExpandOccurrences(record Reminder, from, to time.Time) []Occurrence {
	occurrences := []Occurrence{}
	effectiveFrom := maxDate(from, record.StartDate)
	if to.Before(effectiveFrom) {
		return occurrences
	}
	switch record.Kind {
	case KindOneTime:
		if !record.StartDate.Before(from) && !record.StartDate.After(to) {
			occurrences = append(occurrences, occurrenceFromRecord(record, record.StartDate))
		}
	case KindRecurring:
		if record.ScheduleType == nil {
			return occurrences
		}
		limit := to
		if record.EndDate != nil && record.EndDate.Before(limit) {
			limit = *record.EndDate
		}
		if limit.Before(effectiveFrom) {
			return occurrences
		}
		switch *record.ScheduleType {
		case ScheduleDaily:
			for current := effectiveFrom; !current.After(limit); current = current.AddDate(0, 0, 1) {
				occurrences = append(occurrences, occurrenceFromRecord(record, current))
			}
		case ScheduleWeekly:
			first := NextWeeklyOccurrence(effectiveFrom, record.StartDate)
			for current := first; !current.After(limit); current = current.AddDate(0, 0, 7) {
				occurrences = append(occurrences, occurrenceFromRecord(record, current))
			}
		case ScheduleMonthly:
			for current := NextMonthlyOccurrence(effectiveFrom, record.StartDate); !current.IsZero() && !current.After(limit); current = NextMonthlyOccurrence(current.AddDate(0, 0, 1), record.StartDate) {
				occurrences = append(occurrences, occurrenceFromRecord(record, current))
			}
		}
	}
	return occurrences
}

func NextWeeklyOccurrence(from, startDate time.Time) time.Time {
	diff := (int(startDate.Weekday()) - int(from.Weekday()) + 7) % 7
	return from.AddDate(0, 0, diff)
}

func NextMonthlyOccurrence(from, startDate time.Time) time.Time {
	current := dateOnly(from, from.Location())
	year, month, _ := current.Date()
	startDay := startDate.Day()
	for i := 0; i < 240; i++ {
		daysInMonth := time.Date(year, month+1, 0, 0, 0, 0, 0, current.Location()).Day()
		if startDay <= daysInMonth {
			candidate := time.Date(year, month, startDay, 0, 0, 0, 0, current.Location())
			if !candidate.Before(current) {
				return candidate
			}
		}
		current = time.Date(year, month, 1, 0, 0, 0, 0, current.Location()).AddDate(0, 1, 0)
		year, month, _ = current.Date()
	}
	return time.Time{}
}

func occurrenceFromRecord(record Reminder, date time.Time) Occurrence {
	return Occurrence{
		ReminderID:   record.ID,
		Date:         date,
		Title:        record.Title,
		Notes:        record.Notes,
		Kind:         record.Kind,
		ScheduleType: record.ScheduleType,
	}
}

func maxDate(values ...time.Time) time.Time {
	max := values[0]
	for _, value := range values[1:] {
		if value.After(max) {
			max = value
		}
	}
	return max
}

func dateOnly(t time.Time, loc *time.Location) time.Time {
	tt := t.In(loc)
	return time.Date(tt.Year(), tt.Month(), tt.Day(), 0, 0, 0, 0, loc)
}
