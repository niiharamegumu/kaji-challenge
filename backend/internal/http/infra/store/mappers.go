package store

import (
	"time"

	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

func (u userRecord) toAPI() api.User {
	return api.User{
		Id:          u.ID,
		Email:       u.Email,
		DisplayName: u.Name,
		CreatedAt:   u.CreatedAt,
	}
}

func (t taskRecord) toAPI() api.Task {
	return api.Task{
		Id:                         t.ID,
		TeamId:                     t.TeamID,
		Title:                      t.Title,
		Notes:                      t.Notes,
		Type:                       t.Type,
		PenaltyPoints:              t.Penalty,
		AssigneeUserId:             t.AssigneeID,
		RequiredCompletionsPerWeek: t.Required,
		CreatedAt:                  t.CreatedAt,
		UpdatedAt:                  t.UpdatedAt,
	}
}

func (r ruleRecord) toAPI() api.PenaltyRule {
	return api.PenaltyRule{
		Id:          r.ID,
		TeamId:      r.TeamID,
		Threshold:   r.Threshold,
		Name:        r.Name,
		Description: r.Description,
		DeletedAt:   r.DeletedAt,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
	}
}

func (m monthSummary) toAPI() api.MonthlyPenaltySummary {
	return api.MonthlyPenaltySummary{
		Month:                   m.Month,
		TeamId:                  m.TeamID,
		DailyPenaltyTotal:       m.DailyPenalty,
		WeeklyPenaltyTotal:      m.WeeklyPenalty,
		TotalPenalty:            m.DailyPenalty + m.WeeklyPenalty,
		IsClosed:                m.IsClosed,
		TriggeredPenaltyRuleIds: m.TriggeredRuleID,
		TaskStatusByDate:        m.TaskStatusByDate,
	}
}

func taskFromGetRow(row dbsqlc.GetTaskByIDRow, loc *time.Location) taskRecord {
	return taskRecord{
		ID:         row.ID,
		TeamID:     row.TeamID,
		Title:      row.Title,
		Notes:      ptrFromText(row.Notes),
		Type:       api.TaskType(row.Type),
		Penalty:    int(row.PenaltyPoints),
		AssigneeID: ptrFromAny(row.AssigneeUserID),
		Required:   int(row.RequiredCompletionsPerWeek),
		CreatedAt:  row.CreatedAt.Time.In(loc),
		UpdatedAt:  row.UpdatedAt.Time.In(loc),
		DeletedAt:  ptrFromTimestamptz(row.DeletedAt, loc),
	}
}

func taskFromListRow(row dbsqlc.ListTasksByTeamIDRow, loc *time.Location) taskRecord {
	return taskRecord{
		ID:         row.ID,
		TeamID:     row.TeamID,
		Title:      row.Title,
		Notes:      ptrFromText(row.Notes),
		Type:       api.TaskType(row.Type),
		Penalty:    int(row.PenaltyPoints),
		AssigneeID: ptrFromAny(row.AssigneeUserID),
		Required:   int(row.RequiredCompletionsPerWeek),
		CreatedAt:  row.CreatedAt.Time.In(loc),
		UpdatedAt:  row.UpdatedAt.Time.In(loc),
		DeletedAt:  ptrFromTimestamptz(row.DeletedAt, loc),
	}
}

func taskFromUndeletedListRow(row dbsqlc.ListUndeletedTasksByTeamIDRow, loc *time.Location) taskRecord {
	return taskRecord{
		ID:         row.ID,
		TeamID:     row.TeamID,
		Title:      row.Title,
		Notes:      ptrFromText(row.Notes),
		Type:       api.TaskType(row.Type),
		Penalty:    int(row.PenaltyPoints),
		AssigneeID: ptrFromAny(row.AssigneeUserID),
		Required:   int(row.RequiredCompletionsPerWeek),
		CreatedAt:  row.CreatedAt.Time.In(loc),
		UpdatedAt:  row.UpdatedAt.Time.In(loc),
		DeletedAt:  ptrFromTimestamptz(row.DeletedAt, loc),
	}
}

func taskFromEffectiveCloseRow(row dbsqlc.ListTasksEffectiveForCloseByTeamAndTypeRow, loc *time.Location) taskRecord {
	return taskRecord{
		ID:         row.ID,
		TeamID:     row.TeamID,
		Title:      row.Title,
		Notes:      ptrFromText(row.Notes),
		Type:       api.TaskType(row.Type),
		Penalty:    int(row.PenaltyPoints),
		AssigneeID: ptrFromAny(row.AssigneeUserID),
		Required:   int(row.RequiredCompletionsPerWeek),
		CreatedAt:  row.CreatedAt.Time.In(loc),
		UpdatedAt:  row.UpdatedAt.Time.In(loc),
		DeletedAt:  ptrFromTimestamptz(row.DeletedAt, loc),
	}
}

func ruleFromDB(row dbsqlc.PenaltyRule, loc *time.Location) ruleRecord {
	return ruleRecord{
		ID:          row.ID,
		TeamID:      row.TeamID,
		Threshold:   int(row.Threshold),
		Name:        row.Name,
		Description: ptrFromText(row.Description),
		DeletedAt:   ptrFromTimestamptz(row.DeletedAt, loc),
		CreatedAt:   row.CreatedAt.Time.In(loc),
		UpdatedAt:   row.UpdatedAt.Time.In(loc),
	}
}
