package store

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	model "github.com/megu/kaji-challenge/backend/internal/http/application/model"
)

func (s *Store) ListReminderDefinitions(ctx context.Context, userID string) ([]model.Reminder, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return nil, err
	}
	if err := s.cleanupExpiredOneTimeReminders(ctx, teamID); err != nil {
		return nil, err
	}
	rows, err := s.q.ListRemindersByTeamID(ctx, teamID)
	if err != nil {
		return nil, err
	}
	items := make([]model.Reminder, 0, len(rows))
	for _, row := range rows {
		items = append(items, reminderFromDB(row, s.loc).toAPI())
	}
	return items, nil
}

func (s *Store) ListReminders(ctx context.Context, userID string, from, to time.Time) ([]model.ReminderCalendarDay, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return nil, err
	}
	if err := s.cleanupExpiredOneTimeReminders(ctx, teamID); err != nil {
		return nil, err
	}
	fromDate := dateOnly(from, s.loc)
	toDateValue := dateOnly(to, s.loc)
	if toDateValue.Before(fromDate) {
		return nil, errors.New("to must be on or after from")
	}
	currentMonthStart := monthStartDate(dateOnly(s.now(), s.loc), s.loc)
	if toDateValue.Before(currentMonthStart) {
		return []model.ReminderCalendarDay{}, nil
	}
	fromDate = maxDate(fromDate, currentMonthStart)

	rows, err := s.q.ListRemindersByTeamID(ctx, teamID)
	if err != nil {
		return nil, err
	}

	days := make(map[string][]model.ReminderOccurrence)
	for _, row := range rows {
		record := reminderFromDB(row, s.loc)
		for _, occurrence := range expandReminderOccurrences(record, fromDate, toDateValue) {
			dateKey := occurrence.Date.Time.Format("2006-01-02")
			days[dateKey] = append(days[dateKey], occurrence)
		}
	}

	orderedKeys := make([]string, 0, len(days))
	for key := range days {
		orderedKeys = append(orderedKeys, key)
	}
	sort.Strings(orderedKeys)

	response := make([]model.ReminderCalendarDay, 0, len(orderedKeys))
	for _, key := range orderedKeys {
		response = append(response, model.ReminderCalendarDay{
			Date:  toDate(dateMustParse(key, s.loc)),
			Items: days[key],
		})
	}
	return response, nil
}

func (s *Store) CreateReminder(ctx context.Context, userID string, req model.CreateReminderRequest) (model.Reminder, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return model.Reminder{}, err
	}

	title := strings.TrimSpace(req.Title)
	if title == "" {
		return model.Reminder{}, errors.New("title is required")
	}

	record, err := buildReminderRecordFromCreate(teamID, title, req, s.loc, s.now())
	if err != nil {
		return model.Reminder{}, err
	}
	record.ID = s.nextID("rem")

	if _, err := s.runWithTeamRevisionCAS(
		ctx,
		teamID,
		"reminder",
		map[string]string{"reminderId": record.ID, "action": "create"},
		func(txCtx context.Context, qtx *dbsqlc.Queries) error {
			if err := cleanupExpiredOneTimeRemindersTx(txCtx, qtx, teamID, dateOnly(s.now(), s.loc)); err != nil {
				return err
			}
			return qtx.CreateReminder(txCtx, dbsqlc.CreateReminderParams{
				ID:           record.ID,
				TeamID:       record.TeamID,
				Title:        record.Title,
				Notes:        textFromPtr(record.Notes),
				Kind:         string(record.Kind),
				ScheduleType: textFromPtr(reminderScheduleTypeString(record.ScheduleType)),
				StartDate:    toPgDate(record.StartDate),
				EndDate:      pgDateFromPtr(record.EndDate),
				CreatedAt:    toPgTimestamptz(record.CreatedAt),
				UpdatedAt:    toPgTimestamptz(record.UpdatedAt),
			})
		},
	); err != nil {
		return model.Reminder{}, err
	}

	return record.toAPI(), nil
}

func (s *Store) PatchReminder(ctx context.Context, userID, reminderID string, req model.UpdateReminderRequest) (model.Reminder, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return model.Reminder{}, err
	}

	var record reminderRecord
	if _, err := s.runWithTeamRevisionCAS(
		ctx,
		teamID,
		"reminder",
		map[string]string{"reminderId": reminderID, "action": "update"},
		func(txCtx context.Context, qtx *dbsqlc.Queries) error {
			if err := cleanupExpiredOneTimeRemindersTx(txCtx, qtx, teamID, dateOnly(s.now(), s.loc)); err != nil {
				return err
			}

			row, err := qtx.GetReminderByID(txCtx, reminderID)
			if err != nil {
				return errors.New("reminder not found")
			}
			record = reminderFromDB(row, s.loc)
			if record.TeamID != teamID {
				return errors.New("reminder not found")
			}
			if req.Title != nil {
				title := strings.TrimSpace(*req.Title)
				if title == "" {
					return errors.New("title cannot be empty")
				}
				record.Title = title
			}
			if req.Notes != nil {
				record.Notes = normalizeOptionalString(req.Notes)
			}
			if req.Kind != nil {
				record.Kind = *req.Kind
			}
			if req.ScheduleType != nil {
				record.ScheduleType = req.ScheduleType
			}
			if req.StartDate != nil {
				record.StartDate = dateOnly(req.StartDate.Time, s.loc)
			}
			if req.EndDate != nil {
				record.EndDate = dateTimePtr(req.EndDate, s.loc)
			}
			if req.Kind != nil && *req.Kind == model.OneTime {
				record.ScheduleType = nil
				record.EndDate = nil
			}
			if err := validateReminderRecord(record); err != nil {
				return err
			}
			record.UpdatedAt = s.now()
			return qtx.UpdateReminder(txCtx, dbsqlc.UpdateReminderParams{
				ID:           record.ID,
				Title:        record.Title,
				Notes:        textFromPtr(record.Notes),
				Kind:         string(record.Kind),
				ScheduleType: textFromPtr(reminderScheduleTypeString(record.ScheduleType)),
				StartDate:    toPgDate(record.StartDate),
				EndDate:      pgDateFromPtr(record.EndDate),
				UpdatedAt:    toPgTimestamptz(record.UpdatedAt),
			})
		},
	); err != nil {
		return model.Reminder{}, err
	}
	return record.toAPI(), nil
}

func (s *Store) DeleteReminder(ctx context.Context, userID, reminderID string) error {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return err
	}
	_, err = s.runWithTeamRevisionCAS(
		ctx,
		teamID,
		"reminder",
		map[string]string{"reminderId": reminderID, "action": "delete"},
		func(txCtx context.Context, qtx *dbsqlc.Queries) error {
			if err := cleanupExpiredOneTimeRemindersTx(txCtx, qtx, teamID, dateOnly(s.now(), s.loc)); err != nil {
				return err
			}
			row, err := qtx.GetReminderByID(txCtx, reminderID)
			if err != nil {
				return errors.New("reminder not found")
			}
			if row.TeamID != teamID {
				return errors.New("reminder not found")
			}
			deleted, err := qtx.DeleteReminder(txCtx, reminderID)
			if err != nil {
				return err
			}
			if deleted != 1 {
				return errors.New("reminder not found")
			}
			return nil
		},
	)
	return err
}

func (s *Store) cleanupExpiredOneTimeReminders(ctx context.Context, teamID string) error {
	deletedRows, err := s.queries(ctx).DeleteExpiredOneTimeRemindersByTeam(ctx, dbsqlc.DeleteExpiredOneTimeRemindersByTeamParams{
		TeamID:    teamID,
		StartDate: toPgDate(monthStartDate(dateOnly(s.now(), s.loc), s.loc)),
	})
	if err != nil {
		return err
	}
	if deletedRows > 0 {
		_, _ = s.bumpTeamRevisionBestEffort(ctx, teamID, "reminder", map[string]string{"action": "expire"})
	}
	return nil
}

func cleanupExpiredOneTimeRemindersTx(ctx context.Context, qtx *dbsqlc.Queries, teamID string, today time.Time) error {
	_, err := qtx.DeleteExpiredOneTimeRemindersByTeam(ctx, dbsqlc.DeleteExpiredOneTimeRemindersByTeamParams{
		TeamID:    teamID,
		StartDate: toPgDate(monthStartDate(today, today.Location())),
	})
	return err
}

func buildReminderRecordFromCreate(teamID, title string, req model.CreateReminderRequest, loc *time.Location, now time.Time) (reminderRecord, error) {
	record := reminderRecord{
		ID:        "",
		TeamID:    teamID,
		Title:     title,
		Notes:     normalizeOptionalString(req.Notes),
		Kind:      req.Kind,
		StartDate: dateOnly(req.StartDate.Time, loc),
		CreatedAt: now,
		UpdatedAt: now,
	}
	if req.ScheduleType != nil {
		record.ScheduleType = req.ScheduleType
	}
	if req.EndDate != nil {
		record.EndDate = dateTimePtr(req.EndDate, loc)
	}
	if err := validateReminderRecord(record); err != nil {
		return reminderRecord{}, err
	}
	return record, nil
}

func validateReminderRecord(record reminderRecord) error {
	if strings.TrimSpace(record.Title) == "" {
		return errors.New("title is required")
	}
	if record.Kind == model.OneTime {
		if record.ScheduleType != nil {
			return errors.New("one-time reminder cannot have schedule type")
		}
		if record.EndDate != nil {
			return errors.New("one-time reminder cannot have end date")
		}
		return nil
	}
	if record.Kind != model.Recurring {
		return fmt.Errorf("invalid reminder kind: %s", record.Kind)
	}
	if record.ScheduleType == nil {
		return errors.New("recurring reminder requires schedule type")
	}
	switch *record.ScheduleType {
	case model.ReminderScheduleTypeDaily, model.ReminderScheduleTypeWeekly, model.ReminderScheduleTypeMonthly:
	default:
		return fmt.Errorf("invalid reminder schedule type: %s", *record.ScheduleType)
	}
	if record.EndDate != nil && dateOnly(record.EndDate.In(record.StartDate.Location()), record.StartDate.Location()).Before(record.StartDate) {
		return errors.New("end date must be on or after start date")
	}
	return nil
}

func expandReminderOccurrences(record reminderRecord, from, to time.Time) []model.ReminderOccurrence {
	occurrences := []model.ReminderOccurrence{}
	effectiveFrom := maxDate(from, record.StartDate)
	if to.Before(effectiveFrom) {
		return occurrences
	}
	switch record.Kind {
	case model.OneTime:
		if !record.StartDate.Before(from) && !record.StartDate.After(to) {
			occurrences = append(occurrences, reminderOccurrenceFromRecord(record, record.StartDate))
		}
	case model.Recurring:
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
		case model.ReminderScheduleTypeDaily:
			for current := effectiveFrom; !current.After(limit); current = current.AddDate(0, 0, 1) {
				occurrences = append(occurrences, reminderOccurrenceFromRecord(record, current))
			}
		case model.ReminderScheduleTypeWeekly:
			first := nextWeeklyOccurrence(effectiveFrom, record.StartDate)
			for current := first; !current.After(limit); current = current.AddDate(0, 0, 7) {
				occurrences = append(occurrences, reminderOccurrenceFromRecord(record, current))
			}
		case model.ReminderScheduleTypeMonthly:
			for current := nextMonthlyOccurrence(effectiveFrom, record.StartDate); !current.IsZero() && !current.After(limit); current = nextMonthlyOccurrence(current.AddDate(0, 0, 1), record.StartDate) {
				occurrences = append(occurrences, reminderOccurrenceFromRecord(record, current))
			}
		}
	}
	return occurrences
}

func reminderOccurrenceFromRecord(record reminderRecord, date time.Time) model.ReminderOccurrence {
	return model.ReminderOccurrence{
		ReminderId:   record.ID,
		Date:         toDate(date),
		Title:        record.Title,
		Notes:        record.Notes,
		Kind:         record.Kind,
		ScheduleType: record.ScheduleType,
	}
}

func nextWeeklyOccurrence(from, startDate time.Time) time.Time {
	diff := (int(startDate.Weekday()) - int(from.Weekday()) + 7) % 7
	return from.AddDate(0, 0, diff)
}

func nextMonthlyOccurrence(from, startDate time.Time) time.Time {
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

func maxDate(values ...time.Time) time.Time {
	max := values[0]
	for _, value := range values[1:] {
		if value.After(max) {
			max = value
		}
	}
	return max
}

func monthStartDate(value time.Time, loc *time.Location) time.Time {
	normalized := dateOnly(value, loc)
	return time.Date(normalized.Year(), normalized.Month(), 1, 0, 0, 0, 0, loc)
}

func dateMustParse(value string, loc *time.Location) time.Time {
	parsed, err := time.ParseInLocation("2006-01-02", value, loc)
	if err != nil {
		return time.Time{}
	}
	return parsed
}

func reminderScheduleTypeString(value *model.ReminderScheduleType) *string {
	if value == nil {
		return nil
	}
	raw := string(*value)
	return &raw
}

func pgDateFromPtr(value *time.Time) pgtype.Date {
	if value == nil {
		return pgtype.Date{}
	}
	return toPgDate(*value)
}

func dateTimePtr(value *model.Date, loc *time.Location) *time.Time {
	if value == nil {
		return nil
	}
	normalized := dateOnly(value.Time, loc)
	return &normalized
}
