package store

import (
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
)

func (u userRecord) toAPI() model.User {
	return model.User{
		Id:          u.ID,
		Email:       u.Email,
		DisplayName: u.Name,
		CreatedAt:   u.CreatedAt,
	}
}

func (t taskRecord) toAPI() model.Task {
	return model.Task{
		Id:                         t.ID,
		TeamId:                     t.TeamID,
		Title:                      t.Title,
		Notes:                      t.Notes,
		Type:                       t.Type,
		PenaltyPoints:              t.Penalty,
		AssigneeUserId:             t.AssigneeID,
		RequiredCompletionsPerWeek: t.Required,
		SortKey:                    t.SortKey,
		CreatedAt:                  t.CreatedAt,
		UpdatedAt:                  t.UpdatedAt,
	}
}

func (r ruleRecord) toAPI() model.PenaltyRule {
	return model.PenaltyRule{
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

func (i shoppingItemRecord) toAPI() model.ShoppingListItem {
	return model.ShoppingListItem{
		Id:        i.ID,
		TeamId:    i.TeamID,
		Name:      i.Name,
		Quantity:  i.Quantity,
		Notes:     i.Notes,
		SortKey:   i.SortKey,
		CreatedAt: i.CreatedAt,
		UpdatedAt: i.UpdatedAt,
	}
}

func (r reminderRecord) toAPI() model.Reminder {
	return model.Reminder{
		Id:           r.ID,
		TeamId:       r.TeamID,
		Title:        r.Title,
		Notes:        r.Notes,
		Kind:         r.Kind,
		ScheduleType: r.ScheduleType,
		StartDate:    toDate(r.StartDate),
		EndDate:      datePtr(r.EndDate),
		CreatedAt:    r.CreatedAt,
		UpdatedAt:    r.UpdatedAt,
	}
}

func reminderFromDB(row dbsqlc.Reminder, loc *time.Location) reminderRecord {
	var scheduleType *model.ReminderScheduleType
	if row.ScheduleType.Valid {
		value := model.ReminderScheduleType(row.ScheduleType.String)
		scheduleType = &value
	}
	return reminderRecord{
		ID:           row.ID,
		TeamID:       row.TeamID,
		Title:        row.Title,
		Notes:        ptrFromText(row.Notes),
		Kind:         model.ReminderKind(row.Kind),
		ScheduleType: scheduleType,
		StartDate:    row.StartDate.Time.In(loc),
		EndDate:      ptrFromDate(row.EndDate, loc),
		CreatedAt:    row.CreatedAt.Time.In(loc),
		UpdatedAt:    row.UpdatedAt.Time.In(loc),
	}
}

func taskFromGetRow(row dbsqlc.GetTaskByIDRow, loc *time.Location) taskRecord {
	return taskRecord{
		ID:         row.ID,
		TeamID:     row.TeamID,
		Title:      row.Title,
		Notes:      ptrFromText(row.Notes),
		Type:       model.TaskType(row.Type),
		Penalty:    int(row.PenaltyPoints),
		AssigneeID: ptrFromAny(row.AssigneeUserID),
		Required:   int(row.RequiredCompletionsPerWeek),
		SortKey:    int(row.SortKey),
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
		Type:       model.TaskType(row.Type),
		Penalty:    int(row.PenaltyPoints),
		AssigneeID: ptrFromAny(row.AssigneeUserID),
		Required:   int(row.RequiredCompletionsPerWeek),
		SortKey:    int(row.SortKey),
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
		Type:       model.TaskType(row.Type),
		Penalty:    int(row.PenaltyPoints),
		AssigneeID: ptrFromAny(row.AssigneeUserID),
		Required:   int(row.RequiredCompletionsPerWeek),
		SortKey:    int(row.SortKey),
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

func shoppingItemFromDB(row dbsqlc.ShoppingItem, loc *time.Location) shoppingItemRecord {
	return shoppingItemRecord{
		ID:        row.ID,
		TeamID:    row.TeamID,
		Name:      row.Name,
		Quantity:  ptrFromText(row.Quantity),
		Notes:     ptrFromText(row.Notes),
		SortKey:   int(row.SortKey),
		CreatedAt: row.CreatedAt.Time.In(loc),
		UpdatedAt: row.UpdatedAt.Time.In(loc),
	}
}
