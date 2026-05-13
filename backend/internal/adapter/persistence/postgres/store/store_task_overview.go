package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	"github.com/megu/kaji-challenge/backend/internal/application/ports"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
)

func (s *Store) EnsureMonthSummary(ctx context.Context, teamID, month string) (ports.MonthlyPenaltySummarySnapshot, error) {
	row, err := s.ensureMonthSummaryLocked(ctx, teamID, month)
	if err != nil {
		return ports.MonthlyPenaltySummarySnapshot{}, err
	}
	return ports.MonthlyPenaltySummarySnapshot{
		TeamID:             row.TeamID,
		MonthStart:         row.MonthStart.Time.In(s.loc),
		DailyPenaltyTotal:  int(row.DailyPenaltyTotal),
		WeeklyPenaltyTotal: int(row.WeeklyPenaltyTotal),
		IsClosed:           row.IsClosed,
	}, nil
}

func (s *Store) ListOverviewTasks(ctx context.Context, teamID string) ([]ports.OverviewTask, error) {
	rows, err := s.q.ListUndeletedTasksByTeamID(ctx, teamID)
	if err != nil {
		return nil, err
	}
	items := make([]ports.OverviewTask, 0, len(rows))
	for _, row := range rows {
		task := taskFromUndeletedListRow(row, s.loc)
		items = append(items, overviewTaskFromRecord(task))
	}
	return items, nil
}

func (s *Store) ListDailyCompletionActors(ctx context.Context, teamID string, targetDate time.Time) ([]ports.DailyCompletionActor, error) {
	rows, err := s.q.ListTaskCompletionDailyByTeamAndDate(ctx, dbsqlc.ListTaskCompletionDailyByTeamAndDateParams{
		TeamID:     teamID,
		TargetDate: toPgDate(targetDate),
	})
	if err != nil {
		return nil, err
	}
	items := make([]ports.DailyCompletionActor, 0, len(rows))
	for _, row := range rows {
		items = append(items, ports.DailyCompletionActor{
			TaskID: row.TaskID,
			Actor:  taskCompletionActor(row.CompletedByUserID, row.CompletedByEffectiveName, row.CompletedByColorHex),
		})
	}
	return items, nil
}

func (s *Store) ListWeeklyCompletionCounts(ctx context.Context, teamID string, weekStart time.Time) ([]ports.WeeklyCompletionCount, error) {
	rows, err := s.q.ListTaskCompletionWeeklyCountsByTeamAndWeek(ctx, dbsqlc.ListTaskCompletionWeeklyCountsByTeamAndWeekParams{
		TeamID:    teamID,
		WeekStart: toPgDate(weekStart),
	})
	if err != nil {
		return nil, err
	}
	items := make([]ports.WeeklyCompletionCount, 0, len(rows))
	for _, row := range rows {
		items = append(items, ports.WeeklyCompletionCount{TaskID: row.TaskID, CompletionCount: int(row.CompletionCount)})
	}
	return items, nil
}

func (s *Store) ListWeeklyCompletionSlots(ctx context.Context, teamID string, weekStart time.Time) ([]ports.WeeklyCompletionSlot, error) {
	rows, err := s.q.ListTaskCompletionWeeklySlotsByTeamAndWeek(ctx, dbsqlc.ListTaskCompletionWeeklySlotsByTeamAndWeekParams{
		TeamID:    teamID,
		WeekStart: toPgDate(weekStart),
	})
	if err != nil {
		return nil, err
	}
	items := make([]ports.WeeklyCompletionSlot, 0, len(rows))
	for _, row := range rows {
		items = append(items, ports.WeeklyCompletionSlot{
			TaskID: row.TaskID,
			Slot:   int(row.Slot),
			Actor:  taskCompletionActor(row.CompletedByUserID, row.CompletedByEffectiveName, row.CompletedByColorHex),
		})
	}
	return items, nil
}

func (s *Store) ListReminderRecords(ctx context.Context, teamID string) ([]ports.ReminderRecord, error) {
	rows, err := s.q.ListRemindersByTeamID(ctx, teamID)
	if err != nil {
		return nil, err
	}
	items := make([]ports.ReminderRecord, 0, len(rows))
	for _, row := range rows {
		record := reminderFromDB(row, s.loc)
		items = append(items, reminderRecordToPort(record))
	}
	return items, nil
}

func (s *Store) ListTriggeredRuleIDs(ctx context.Context, teamID string, monthStart time.Time) ([]string, error) {
	return s.q.ListTriggeredRuleIDsByMonth(ctx, dbsqlc.ListTriggeredRuleIDsByMonthParams{
		TeamID:     teamID,
		MonthStart: toPgDate(monthStart),
	})
}

func (s *Store) ListEffectivePenaltyRules(ctx context.Context, teamID string, asOf time.Time) ([]ports.PenaltyRuleSnapshot, error) {
	rows, err := s.q.ListPenaltyRulesEffectiveAtByTeamID(ctx, dbsqlc.ListPenaltyRulesEffectiveAtByTeamIDParams{
		TeamID: teamID,
		AsOf:   toPgTimestamptz(asOf),
	})
	if err != nil {
		return nil, err
	}
	items := make([]ports.PenaltyRuleSnapshot, 0, len(rows))
	for _, row := range rows {
		items = append(items, ports.PenaltyRuleSnapshot{ID: row.ID, Threshold: int(row.Threshold)})
	}
	return items, nil
}

func (s *Store) ListMonthlyStatusTasks(ctx context.Context, teamID string, monthStart, monthEnd time.Time) ([]ports.MonthlyTaskStatusRecord, error) {
	rows, err := s.q.ListTasksForMonthlyStatusByTeam(ctx, dbsqlc.ListTasksForMonthlyStatusByTeamParams{
		TeamID:    teamID,
		DeletedAt: toPgTimestamptz(monthStart),
		CreatedAt: toPgTimestamptz(monthEnd),
	})
	if err != nil {
		return nil, err
	}
	items := make([]ports.MonthlyTaskStatusRecord, 0, len(rows))
	for _, row := range rows {
		items = append(items, ports.MonthlyTaskStatusRecord{
			ID:                         row.ID,
			TeamID:                     teamID,
			Title:                      row.Title,
			Notes:                      ptrFromText(row.Notes),
			Type:                       model.TaskType(row.Type),
			PenaltyPoints:              int(row.PenaltyPoints),
			RequiredCompletionsPerWeek: int(row.RequiredCompletionsPerWeek),
			SortKey:                    int(row.SortKey),
			CreatedAt:                  row.CreatedAt.Time.In(s.loc),
			DeletedAt:                  ptrFromTimestamptz(row.DeletedAt, s.loc),
		})
	}
	return items, nil
}

func (s *Store) ListDailyCompletionsByMonth(ctx context.Context, teamID string, monthStart, monthEnd time.Time) ([]ports.DailyCompletionByDate, error) {
	rows, err := s.q.ListTaskCompletionDailyByMonthAndTeam(ctx, dbsqlc.ListTaskCompletionDailyByMonthAndTeamParams{
		TeamID:       teamID,
		TargetDate:   toPgDate(monthStart),
		TargetDate_2: toPgDate(monthEnd),
	})
	if err != nil {
		return nil, err
	}
	items := make([]ports.DailyCompletionByDate, 0, len(rows))
	for _, row := range rows {
		items = append(items, ports.DailyCompletionByDate{
			Date:   row.TargetDate.Time.In(s.loc),
			TaskID: row.TaskID,
			Actor:  taskCompletionActor(row.CompletedByUserID, row.CompletedByEffectiveName, row.CompletedByColorHex),
		})
	}
	return items, nil
}

func (s *Store) ListWeeklyCompletionCountsByMonth(ctx context.Context, teamID string, weekStart, monthEnd time.Time) ([]ports.WeeklyCompletionCountByWeek, error) {
	rows, err := s.q.ListTaskCompletionWeeklyByMonthAndTeam(ctx, dbsqlc.ListTaskCompletionWeeklyByMonthAndTeamParams{
		TeamID:      teamID,
		WeekStart:   toPgDate(weekStart),
		WeekStart_2: toPgDate(monthEnd),
	})
	if err != nil {
		return nil, err
	}
	items := make([]ports.WeeklyCompletionCountByWeek, 0, len(rows))
	for _, row := range rows {
		items = append(items, ports.WeeklyCompletionCountByWeek{
			WeekStart:       row.WeekStart.Time.In(s.loc),
			TaskID:          row.TaskID,
			CompletionCount: int(row.CompletionCount),
		})
	}
	return items, nil
}

func (s *Store) ListWeeklyCompletionSlotsByMonth(ctx context.Context, teamID string, weekStart, monthEnd time.Time) ([]ports.WeeklyCompletionSlotByWeek, error) {
	rows, err := s.q.ListTaskCompletionWeeklySlotsByMonthAndTeam(ctx, dbsqlc.ListTaskCompletionWeeklySlotsByMonthAndTeamParams{
		TeamID:      teamID,
		WeekStart:   toPgDate(weekStart),
		WeekStart_2: toPgDate(monthEnd),
	})
	if err != nil {
		return nil, err
	}
	items := make([]ports.WeeklyCompletionSlotByWeek, 0, len(rows))
	for _, row := range rows {
		items = append(items, ports.WeeklyCompletionSlotByWeek{
			WeekStart: row.WeekStart.Time.In(s.loc),
			TaskID:    row.TaskID,
			Slot:      int(row.Slot),
			Actor:     taskCompletionActor(row.CompletedByUserID, row.CompletedByEffectiveName, row.CompletedByColorHex),
		})
	}
	return items, nil
}

func (s *Store) ensureMonthSummaryLocked(ctx context.Context, teamID, month string) (dbsqlc.MonthlyPenaltySummary, error) {
	monthStart, err := monthStartFromKey(month, s.loc)
	if err != nil {
		return dbsqlc.MonthlyPenaltySummary{}, err
	}
	got, err := s.queries(ctx).GetMonthlyPenaltySummary(ctx, dbsqlc.GetMonthlyPenaltySummaryParams{
		TeamID:     teamID,
		MonthStart: toPgDate(monthStart),
	})
	if err == nil {
		return got, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return dbsqlc.MonthlyPenaltySummary{}, err
	}
	if err := s.queries(ctx).UpsertMonthlyPenaltySummary(ctx, dbsqlc.UpsertMonthlyPenaltySummaryParams{
		TeamID:             teamID,
		MonthStart:         toPgDate(monthStart),
		DailyPenaltyTotal:  0,
		WeeklyPenaltyTotal: 0,
		IsClosed:           false,
	}); err != nil {
		return dbsqlc.MonthlyPenaltySummary{}, err
	}
	return s.queries(ctx).GetMonthlyPenaltySummary(ctx, dbsqlc.GetMonthlyPenaltySummaryParams{
		TeamID:     teamID,
		MonthStart: toPgDate(monthStart),
	})
}

func overviewTaskFromRecord(task taskRecord) ports.OverviewTask {
	return ports.OverviewTask{
		ID:                         task.ID,
		TeamID:                     task.TeamID,
		Title:                      task.Title,
		Notes:                      task.Notes,
		Type:                       task.Type,
		PenaltyPoints:              task.Penalty,
		AssigneeUserID:             task.AssigneeID,
		RequiredCompletionsPerWeek: task.Required,
		SortKey:                    task.SortKey,
		CreatedAt:                  task.CreatedAt,
		UpdatedAt:                  task.UpdatedAt,
		DeletedAt:                  task.DeletedAt,
	}
}

func reminderRecordToPort(record reminderRecord) ports.ReminderRecord {
	return ports.ReminderRecord{
		ID:           record.ID,
		TeamID:       record.TeamID,
		Title:        record.Title,
		Notes:        record.Notes,
		Kind:         record.Kind,
		ScheduleType: record.ScheduleType,
		StartDate:    record.StartDate,
		EndDate:      record.EndDate,
		CreatedAt:    record.CreatedAt,
		UpdatedAt:    record.UpdatedAt,
	}
}

func taskCompletionActor(userIDRaw interface{}, effectiveName string, colorHexRaw interface{}) *ports.TaskCompletionActor {
	userID := ptrFromAny(userIDRaw)
	if userID == nil {
		return nil
	}
	return &ports.TaskCompletionActor{
		UserID:        *userID,
		EffectiveName: effectiveName,
		ColorHex:      ptrFromAny(colorHexRaw),
	}
}
