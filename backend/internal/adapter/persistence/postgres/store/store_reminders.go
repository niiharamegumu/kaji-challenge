package store

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	domainreminder "github.com/megu/kaji-challenge/backend/internal/domain/reminder"
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
	if currentMonthStart.After(fromDate) {
		fromDate = currentMonthStart
	}

	rows, err := s.q.ListRemindersByTeamID(ctx, teamID)
	if err != nil {
		return nil, err
	}

	days := make(map[string][]model.ReminderOccurrence)
	for _, row := range rows {
		record := reminderFromDB(row, s.loc)
		for _, occurrence := range domainreminder.ExpandOccurrences(toDomainReminder(record), fromDate, toDateValue) {
			item := reminderOccurrenceFromDomain(occurrence)
			dateKey := occurrence.Date.Format("2006-01-02")
			days[dateKey] = append(days[dateKey], item)
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

	title, err := domainreminder.NormalizeTitle(req.Title)
	if err != nil {
		return model.Reminder{}, err
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
				title, err := domainreminder.NormalizePatchTitle(*req.Title)
				if err != nil {
					return err
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
			if err := domainreminder.Validate(toDomainReminder(record)); err != nil {
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
	if err := domainreminder.Validate(toDomainReminder(record)); err != nil {
		return reminderRecord{}, err
	}
	return record, nil
}

func reminderOccurrenceFromDomain(occurrence domainreminder.Occurrence) model.ReminderOccurrence {
	return model.ReminderOccurrence{
		ReminderId:   occurrence.ReminderID,
		Date:         toDate(occurrence.Date),
		Title:        occurrence.Title,
		Notes:        occurrence.Notes,
		Kind:         model.ReminderKind(occurrence.Kind),
		ScheduleType: modelReminderScheduleTypePtr(occurrence.ScheduleType),
	}
}

func toDomainReminder(record reminderRecord) domainreminder.Reminder {
	return domainreminder.Reminder{
		ID:           record.ID,
		Title:        record.Title,
		Notes:        record.Notes,
		Kind:         domainreminder.Kind(record.Kind),
		ScheduleType: domainReminderScheduleTypePtr(record.ScheduleType),
		StartDate:    record.StartDate,
		EndDate:      record.EndDate,
		CreatedAt:    record.CreatedAt,
		UpdatedAt:    record.UpdatedAt,
	}
}

func domainReminderScheduleTypePtr(value *model.ReminderScheduleType) *domainreminder.ScheduleType {
	if value == nil {
		return nil
	}
	converted := domainreminder.ScheduleType(*value)
	return &converted
}

func modelReminderScheduleTypePtr(value *domainreminder.ScheduleType) *model.ReminderScheduleType {
	if value == nil {
		return nil
	}
	converted := model.ReminderScheduleType(*value)
	return &converted
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
