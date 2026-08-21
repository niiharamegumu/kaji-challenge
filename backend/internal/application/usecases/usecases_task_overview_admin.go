package usecases

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/megu/kaji-challenge/backend/internal/application"
	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	"github.com/megu/kaji-challenge/backend/internal/application/ports"
	domainpenalty "github.com/megu/kaji-challenge/backend/internal/domain/penalty"
	domainreminder "github.com/megu/kaji-challenge/backend/internal/domain/reminder"
	domaintask "github.com/megu/kaji-challenge/backend/internal/domain/task"
)

var errNoCloseStateChange = errors.New("no_state_change")

func (u taskOverviewUsecase) GetTaskOverview(ctx context.Context, userID string) (model.TaskOverviewResponse, error) {
	teamID, err := u.repo.PrimaryTeamID(ctx, userID)
	if err != nil {
		return model.TaskOverviewResponse{}, err
	}
	now := u.repo.Now()
	today := dateOnly(now)
	weekStart := startOfWeek(today, now.Location())
	weekEnd := weekStart.AddDate(0, 0, 6)
	monthKey := monthKeyFromTime(today)
	monthly, err := u.repo.EnsureMonthSummary(ctx, teamID, monthKey)
	if err != nil {
		return model.TaskOverviewResponse{}, err
	}
	if err := u.repo.CleanupExpiredOneTimeReminders(ctx, teamID); err != nil {
		return model.TaskOverviewResponse{}, err
	}

	tasks, err := u.repo.ListOverviewTasks(ctx, teamID)
	if err != nil {
		return model.TaskOverviewResponse{}, err
	}
	dailyRows, err := u.repo.ListDailyCompletionActors(ctx, teamID, today)
	if err != nil {
		return model.TaskOverviewResponse{}, err
	}
	dailyDone := make(map[string]bool, len(dailyRows))
	dailyActorByTaskID := make(map[string]*model.TaskCompletionActor, len(dailyRows))
	for _, row := range dailyRows {
		dailyDone[row.TaskID] = true
		dailyActorByTaskID[row.TaskID] = actorToAPI(row.Actor)
	}
	weeklyRows, err := u.repo.ListWeeklyCompletionCounts(ctx, teamID, weekStart)
	if err != nil {
		return model.TaskOverviewResponse{}, err
	}
	weeklyDone := make(map[string]int, len(weeklyRows))
	for _, row := range weeklyRows {
		weeklyDone[row.TaskID] = row.CompletionCount
	}
	slotRows, err := u.repo.ListWeeklyCompletionSlots(ctx, teamID, weekStart)
	if err != nil {
		return model.TaskOverviewResponse{}, err
	}
	weeklySlotsByTaskID := map[string]map[int]*model.TaskCompletionActor{}
	for _, row := range slotRows {
		if weeklySlotsByTaskID[row.TaskID] == nil {
			weeklySlotsByTaskID[row.TaskID] = map[int]*model.TaskCompletionActor{}
		}
		weeklySlotsByTaskID[row.TaskID][row.Slot] = actorToAPI(row.Actor)
	}

	type overviewReminderOccurrence struct {
		occurrence model.ReminderOccurrence
		createdAt  time.Time
	}
	weeklyReminderItems := []overviewReminderOccurrence{}
	reminders, err := u.repo.ListReminderRecords(ctx, teamID)
	if err != nil {
		return model.TaskOverviewResponse{}, err
	}
	for _, record := range reminders {
		for _, occurrence := range domainreminder.ExpandOccurrences(toDomainReminder(record), today, weekEnd) {
			weeklyReminderItems = append(weeklyReminderItems, overviewReminderOccurrence{
				occurrence: reminderOccurrenceFromDomain(occurrence),
				createdAt:  record.CreatedAt,
			})
		}
	}

	daily := []model.TaskOverviewDailyTask{}
	weekly := []model.TaskOverviewWeeklyTask{}
	for _, task := range tasks {
		if task.Type == model.TaskTypeDaily {
			daily = append(daily, model.TaskOverviewDailyTask{
				Task:           overviewTaskToAPI(task),
				CompletedToday: dailyDone[task.ID],
				CompletedBy:    dailyActorByTaskID[task.ID],
			})
			continue
		}
		weekly = append(weekly, model.TaskOverviewWeeklyTask{
			Task:                       overviewTaskToAPI(task),
			WeekCompletedCount:         weeklyDone[task.ID],
			RequiredCompletionsPerWeek: task.RequiredCompletionsPerWeek,
			CompletionSlots:            buildCompletionSlots(task.RequiredCompletionsPerWeek, weeklySlotsByTaskID[task.ID]),
		})
	}
	sortOverviewDaily(daily)
	sortOverviewWeekly(weekly)
	sort.Slice(weeklyReminderItems, func(i, j int) bool {
		if weeklyReminderItems[i].occurrence.Date.Equal(weeklyReminderItems[j].occurrence.Date.Time) {
			return weeklyReminderItems[i].createdAt.Before(weeklyReminderItems[j].createdAt)
		}
		return weeklyReminderItems[i].occurrence.Date.Before(weeklyReminderItems[j].occurrence.Date.Time)
	})
	weeklyReminders := make([]model.ReminderOccurrence, 0, len(weeklyReminderItems))
	for _, item := range weeklyReminderItems {
		weeklyReminders = append(weeklyReminders, item.occurrence)
	}

	elapsed := int(today.Sub(weekStart).Hours()/24) + 1
	return model.TaskOverviewResponse{
		Month:               monthKey,
		Today:               toDate(today),
		ElapsedDaysInWeek:   elapsed,
		MonthlyPenaltyTotal: monthly.DailyPenaltyTotal + monthly.WeeklyPenaltyTotal,
		DailyTasks:          daily,
		WeeklyTasks:         weekly,
		WeeklyReminders:     weeklyReminders,
	}, nil
}

func (u taskOverviewUsecase) GetMonthlySummary(ctx context.Context, userID string, month *string) (model.MonthlyPenaltySummary, error) {
	teamID, err := u.repo.PrimaryTeamID(ctx, userID)
	if err != nil {
		return model.MonthlyPenaltySummary{}, err
	}
	now := u.repo.Now()
	targetMonth := monthKeyFromTime(now)
	if month != nil && *month != "" {
		targetMonth = *month
	}
	summary, err := u.repo.EnsureMonthSummary(ctx, teamID, targetMonth)
	if err != nil {
		return model.MonthlyPenaltySummary{}, err
	}
	var triggered []string
	if summary.IsClosed {
		triggered, err = u.repo.ListTriggeredRuleIDs(ctx, teamID, summary.MonthStart)
		if err != nil {
			return model.MonthlyPenaltySummary{}, err
		}
	} else {
		monthStart, err := monthStartFromKey(targetMonth, now.Location())
		if err != nil {
			return model.MonthlyPenaltySummary{}, err
		}
		monthEnd := monthStart.AddDate(0, 1, 0)
		asOf := now
		if asOf.After(monthEnd) {
			asOf = monthEnd
		}
		ruleRows, err := u.repo.ListEffectivePenaltyRules(ctx, teamID, asOf)
		if err != nil {
			return model.MonthlyPenaltySummary{}, err
		}
		rules := make([]domainpenalty.Rule, 0, len(ruleRows))
		for _, rule := range ruleRows {
			rules = append(rules, domainpenalty.Rule{ID: rule.ID, Threshold: rule.Threshold})
		}
		triggered = domainpenalty.TriggeredRuleIDs(summary.DailyPenaltyTotal+summary.WeeklyPenaltyTotal, rules)
	}
	taskStatusByDate, err := u.buildMonthlyTaskStatusByDate(ctx, teamID, targetMonth)
	if err != nil {
		return model.MonthlyPenaltySummary{}, err
	}
	if triggered == nil {
		triggered = []string{}
	}
	if taskStatusByDate == nil {
		taskStatusByDate = []model.MonthlyTaskStatusGroup{}
	}
	return model.MonthlyPenaltySummary{
		Month:                   monthKeyFromTime(summary.MonthStart),
		TeamId:                  summary.TeamID,
		DailyPenaltyTotal:       summary.DailyPenaltyTotal,
		WeeklyPenaltyTotal:      summary.WeeklyPenaltyTotal,
		TotalPenalty:            summary.DailyPenaltyTotal + summary.WeeklyPenaltyTotal,
		IsClosed:                summary.IsClosed,
		TriggeredPenaltyRuleIds: triggered,
		TaskStatusByDate:        taskStatusByDate,
	}, nil
}

func (u adminUsecase) ListClosableTeamIDs(ctx context.Context) ([]string, error) {
	return u.repo.ListClosableTeamIDs(ctx)
}

func (u adminUsecase) GetMonthCloseCandidate(ctx context.Context, userID string) (model.MonthCloseCandidateResponse, error) {
	teamID, err := u.repo.PrimaryTeamID(ctx, userID)
	if err != nil {
		return model.MonthCloseCandidateResponse{}, err
	}
	return u.repo.GetMonthCloseCandidate(ctx, teamID)
}

func (u adminUsecase) CloseMonthForUserTarget(ctx context.Context, userID, month string) (model.CloseResponse, error) {
	teamID, err := u.repo.PrimaryTeamID(ctx, userID)
	if err != nil {
		return model.CloseResponse{}, err
	}
	now := u.repo.Now()
	monthStart, err := monthStartFromKey(month, now.Location())
	if err != nil {
		return model.CloseResponse{}, fmt.Errorf("%w: invalid month", application.ErrInvalid)
	}
	currentMonthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	if !monthStart.Before(currentMonthStart) {
		return model.CloseResponse{}, fmt.Errorf("%w: only past months can be closed", application.ErrConflict)
	}
	err = u.repo.RunTeamRevisionCAS(ctx, teamID, "month_close", map[string]string{"month": month}, func(txCtx context.Context) error {
		closed, err := u.repo.IsMonthClosed(txCtx, teamID, month)
		if err != nil {
			return err
		}
		if closed {
			return errNoCloseStateChange
		}
		candidate, err := u.repo.GetMonthCloseCandidate(txCtx, teamID)
		if err != nil {
			return err
		}
		if candidate.Candidate == nil || candidate.Candidate.Month != month {
			return fmt.Errorf("%w: month is not the oldest eligible open month", application.ErrConflict)
		}
		return u.repo.FinalizeMonth(txCtx, teamID, month)
	})
	if err != nil {
		return model.CloseResponse{}, err
	}
	return model.CloseResponse{ClosedAt: now, Month: month}, nil
}

func (u adminUsecase) CloseDayForTeam(ctx context.Context, teamID string) (model.CloseResponse, error) {
	return u.closeDay(ctx, teamID, false)
}

func (u adminUsecase) CloseWeekForTeam(ctx context.Context, teamID string) (model.CloseResponse, error) {
	return u.closeWeek(ctx, teamID, false)
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

func monthKeyFromTime(t time.Time) string {
	return t.In(t.Location()).Format("2006-01")
}

func (u taskOverviewUsecase) buildMonthlyTaskStatusByDate(ctx context.Context, teamID, month string) ([]model.MonthlyTaskStatusGroup, error) {
	now := u.repo.Now()
	monthStart, err := monthStartFromKey(month, now.Location())
	if err != nil {
		return nil, err
	}
	monthEnd := monthStart.AddDate(0, 1, 0)
	todayStart := dateOnly(now)
	displayEndExclusive := monthEnd
	todayEndExclusive := todayStart.AddDate(0, 0, 1)
	if todayEndExclusive.Before(displayEndExclusive) {
		displayEndExclusive = todayEndExclusive
	}
	if !displayEndExclusive.After(monthStart) {
		return []model.MonthlyTaskStatusGroup{}, nil
	}

	tasks, err := u.repo.ListMonthlyStatusTasks(ctx, teamID, monthStart, monthEnd)
	if err != nil {
		return nil, err
	}
	dailyRows, err := u.repo.ListDailyCompletionsByMonth(ctx, teamID, monthStart, monthEnd)
	if err != nil {
		return nil, err
	}
	dailyDone := map[string]map[string]bool{}
	dailyActors := map[string]map[string]*model.TaskCompletionActor{}
	for _, row := range dailyRows {
		dateKey := dateOnly(row.Date).Format("2006-01-02")
		if dailyDone[dateKey] == nil {
			dailyDone[dateKey] = map[string]bool{}
		}
		if dailyActors[dateKey] == nil {
			dailyActors[dateKey] = map[string]*model.TaskCompletionActor{}
		}
		dailyDone[dateKey][row.TaskID] = true
		dailyActors[dateKey][row.TaskID] = actorToAPI(row.Actor)
	}
	weekQueryStart := startOfWeek(monthStart, now.Location())
	weeklyRows, err := u.repo.ListWeeklyCompletionCountsByMonth(ctx, teamID, weekQueryStart, monthEnd)
	if err != nil {
		return nil, err
	}
	weeklyCounts := map[string]map[string]int{}
	for _, row := range weeklyRows {
		weekStartKey := dateOnly(row.WeekStart).Format("2006-01-02")
		if weeklyCounts[weekStartKey] == nil {
			weeklyCounts[weekStartKey] = map[string]int{}
		}
		weeklyCounts[weekStartKey][row.TaskID] = row.CompletionCount
	}
	weeklySlotRows, err := u.repo.ListWeeklyCompletionSlotsByMonth(ctx, teamID, weekQueryStart, monthEnd)
	if err != nil {
		return nil, err
	}
	weeklyActors := map[string]map[string]map[int]*model.TaskCompletionActor{}
	for _, row := range weeklySlotRows {
		weekStartKey := dateOnly(row.WeekStart).Format("2006-01-02")
		if weeklyActors[weekStartKey] == nil {
			weeklyActors[weekStartKey] = map[string]map[int]*model.TaskCompletionActor{}
		}
		if weeklyActors[weekStartKey][row.TaskID] == nil {
			weeklyActors[weekStartKey][row.TaskID] = map[int]*model.TaskCompletionActor{}
		}
		weeklyActors[weekStartKey][row.TaskID][row.Slot] = actorToAPI(row.Actor)
	}

	weeklyAnchorByDay := map[string]time.Time{}
	for weekStart := weekQueryStart; weekStart.Before(monthEnd); weekStart = weekStart.AddDate(0, 0, 7) {
		weekEnd := weekStart.AddDate(0, 0, 6)
		if monthKeyFromTime(weekEnd) != month {
			continue
		}
		anchor := weekStart
		if anchor.Before(monthStart) {
			anchor = monthStart
		}
		weeklyAnchorByDay[anchor.Format("2006-01-02")] = weekStart
	}

	groups := []model.MonthlyTaskStatusGroup{}
	for day := displayEndExclusive.AddDate(0, 0, -1); !day.Before(monthStart); day = day.AddDate(0, 0, -1) {
		dayStart := dateOnly(day)
		dayEnd := dayStart.AddDate(0, 0, 1)
		dayKey := dayStart.Format("2006-01-02")
		items := []model.MonthlyTaskStatusItem{}

		for _, task := range tasks {
			completed := false
			var completionSlots []model.TaskCompletionSlot
			switch task.Type {
			case model.TaskTypeDaily:
				if task.CreatedAt.After(dayEnd.Add(-time.Nanosecond)) {
					continue
				}
				if task.DeletedAt != nil && task.DeletedAt.Before(dayEnd) {
					continue
				}
				completed = dailyDone[dayKey] != nil && dailyDone[dayKey][task.ID]
				completionSlots = buildCompletionSlots(1, map[int]*model.TaskCompletionActor{
					1: dailyActors[dayKey][task.ID],
				})
			case model.TaskTypeWeekly:
				weekStart, ok := weeklyAnchorByDay[dayKey]
				if !ok {
					continue
				}
				weekEnd := weekStart.AddDate(0, 0, 7)
				if task.CreatedAt.After(weekEnd.Add(-time.Nanosecond)) {
					continue
				}
				if task.DeletedAt != nil && task.DeletedAt.Before(weekEnd) {
					continue
				}
				weekStartKey := weekStart.Format("2006-01-02")
				completed = weeklyCounts[weekStartKey] != nil && weeklyCounts[weekStartKey][task.ID] >= task.RequiredCompletionsPerWeek
				completionSlots = buildCompletionSlots(task.RequiredCompletionsPerWeek, weeklyActors[weekStartKey][task.ID])
			default:
				return nil, fmt.Errorf("unknown task type: %s", task.Type)
			}

			items = append(items, model.MonthlyTaskStatusItem{
				TaskId:          task.ID,
				Title:           task.Title,
				Notes:           task.Notes,
				Type:            task.Type,
				PenaltyPoints:   task.PenaltyPoints,
				Completed:       completed,
				IsDeleted:       task.DeletedAt != nil,
				CompletionSlots: completionSlots,
			})
		}
		if len(items) == 0 {
			continue
		}
		sort.Slice(items, func(i, j int) bool {
			if items[i].Type != items[j].Type {
				return items[i].Type < items[j].Type
			}
			leftTask := overviewTaskByID(items[i].TaskId, tasks)
			rightTask := overviewTaskByID(items[j].TaskId, tasks)
			if leftTask.SortKey != rightTask.SortKey {
				return leftTask.SortKey < rightTask.SortKey
			}
			if !leftTask.CreatedAt.Equal(rightTask.CreatedAt) {
				return leftTask.CreatedAt.Before(rightTask.CreatedAt)
			}
			return items[i].TaskId < items[j].TaskId
		})
		groups = append(groups, model.MonthlyTaskStatusGroup{
			Date:  toDate(dayStart),
			Items: items,
		})
	}
	return groups, nil
}

func overviewTaskToAPI(task ports.OverviewTask) model.Task {
	return model.Task{
		Id:                         task.ID,
		TeamId:                     task.TeamID,
		Title:                      task.Title,
		Notes:                      task.Notes,
		Type:                       task.Type,
		PenaltyPoints:              task.PenaltyPoints,
		AssigneeUserId:             task.AssigneeUserID,
		RequiredCompletionsPerWeek: task.RequiredCompletionsPerWeek,
		SortKey:                    task.SortKey,
		CreatedAt:                  task.CreatedAt,
		UpdatedAt:                  task.UpdatedAt,
	}
}

func actorToAPI(actor *ports.TaskCompletionActor) *model.TaskCompletionActor {
	if actor == nil {
		return nil
	}
	return &model.TaskCompletionActor{
		UserId:        actor.UserID,
		EffectiveName: actor.EffectiveName,
		ColorHex:      actor.ColorHex,
	}
}

func sortOverviewDaily(items []model.TaskOverviewDailyTask) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].Task.SortKey != items[j].Task.SortKey {
			return items[i].Task.SortKey < items[j].Task.SortKey
		}
		if !items[i].Task.CreatedAt.Equal(items[j].Task.CreatedAt) {
			return items[i].Task.CreatedAt.Before(items[j].Task.CreatedAt)
		}
		return items[i].Task.Id < items[j].Task.Id
	})
}

func sortOverviewWeekly(items []model.TaskOverviewWeeklyTask) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].Task.SortKey != items[j].Task.SortKey {
			return items[i].Task.SortKey < items[j].Task.SortKey
		}
		if !items[i].Task.CreatedAt.Equal(items[j].Task.CreatedAt) {
			return items[i].Task.CreatedAt.Before(items[j].Task.CreatedAt)
		}
		return items[i].Task.Id < items[j].Task.Id
	})
}

func overviewTaskByID(taskID string, tasks []ports.MonthlyTaskStatusRecord) ports.MonthlyTaskStatusRecord {
	for _, task := range tasks {
		if task.ID == taskID {
			return task
		}
	}
	return ports.MonthlyTaskStatusRecord{}
}

func buildCompletionSlots(required int, actorsBySlot map[int]*model.TaskCompletionActor) []model.TaskCompletionSlot {
	if required < domaintask.RequiredCompletionsPerWeekMin {
		required = domaintask.RequiredCompletionsPerWeekMin
	}
	if required > domaintask.RequiredCompletionsPerWeekMax {
		required = domaintask.RequiredCompletionsPerWeekMax
	}
	slots := make([]model.TaskCompletionSlot, 0, required)
	for idx := 1; idx <= required; idx++ {
		slots = append(slots, model.TaskCompletionSlot{
			Slot:  idx,
			Actor: actorsBySlot[idx],
		})
	}
	return slots
}

func toDomainReminder(record ports.ReminderRecord) domainreminder.Reminder {
	var scheduleType *domainreminder.ScheduleType
	if record.ScheduleType != nil {
		value := domainreminder.ScheduleType(*record.ScheduleType)
		scheduleType = &value
	}
	return domainreminder.Reminder{
		ID:           record.ID,
		Title:        record.Title,
		Notes:        record.Notes,
		Kind:         domainreminder.Kind(record.Kind),
		ScheduleType: scheduleType,
		StartDate:    record.StartDate,
		EndDate:      record.EndDate,
		CreatedAt:    record.CreatedAt,
		UpdatedAt:    record.UpdatedAt,
	}
}

func reminderOccurrenceFromDomain(occurrence domainreminder.Occurrence) model.ReminderOccurrence {
	var scheduleType *model.ReminderScheduleType
	if occurrence.ScheduleType != nil {
		value := model.ReminderScheduleType(*occurrence.ScheduleType)
		scheduleType = &value
	}
	return model.ReminderOccurrence{
		ReminderId:   occurrence.ReminderID,
		Date:         toDate(occurrence.Date),
		Title:        occurrence.Title,
		Notes:        occurrence.Notes,
		Kind:         model.ReminderKind(occurrence.Kind),
		ScheduleType: scheduleType,
	}
}

func toDate(t time.Time) model.Date {
	return model.Date{Time: dateOnly(t)}
}

func monthStartFromKey(month string, loc *time.Location) (time.Time, error) {
	parsed, err := time.ParseInLocation("2006-01", month, loc)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid month format: %s", month)
	}
	return time.Date(parsed.Year(), parsed.Month(), 1, 0, 0, 0, 0, loc), nil
}
