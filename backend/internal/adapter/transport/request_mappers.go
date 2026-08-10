package transport

import (
	"slices"

	"github.com/megu/kaji-challenge/backend/internal/application/model"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

func taskTypeFromAPI(value *api.TaskType) *model.TaskType {
	if value == nil {
		return nil
	}
	mapped := model.TaskType(*value)
	return &mapped
}

func createTaskRequestFromAPI(req api.CreateTaskRequest) model.CreateTaskRequest {
	return model.CreateTaskRequest{
		AssigneeUserId:             req.AssigneeUserId,
		Notes:                      req.Notes,
		PenaltyPoints:              req.PenaltyPoints,
		RequiredCompletionsPerWeek: req.RequiredCompletionsPerWeek,
		Title:                      req.Title,
		Type:                       model.TaskType(req.Type),
	}
}

func updateTaskRequestFromAPI(req api.UpdateTaskRequest) model.UpdateTaskRequest {
	return model.UpdateTaskRequest{
		AssigneeUserId:             req.AssigneeUserId,
		Notes:                      req.Notes,
		PenaltyPoints:              req.PenaltyPoints,
		RequiredCompletionsPerWeek: req.RequiredCompletionsPerWeek,
		Title:                      req.Title,
	}
}

func reorderTasksRequestFromAPI(req api.ReorderTasksRequest) model.ReorderTasksRequest {
	return model.ReorderTasksRequest{TaskIds: slices.Clone(req.TaskIds)}
}

func completionActionFromAPI(value *api.ToggleTaskCompletionRequestAction) *model.ToggleTaskCompletionRequestAction {
	if value == nil {
		return nil
	}
	mapped := model.ToggleTaskCompletionRequestAction(*value)
	return &mapped
}

func updateNicknameRequestFromAPI(req api.UpdateNicknameRequest) model.UpdateNicknameRequest {
	return model.UpdateNicknameRequest{Nickname: req.Nickname}
}

func updateColorRequestFromAPI(req api.UpdateColorRequest) model.UpdateColorRequest {
	return model.UpdateColorRequest{ColorHex: req.ColorHex}
}

func createInviteRequestFromAPI(req api.CreateInviteRequest) model.CreateInviteRequest {
	return model.CreateInviteRequest{ExpiresInHours: req.ExpiresInHours}
}

func updateCurrentTeamRequestFromAPI(req api.UpdateCurrentTeamRequest) model.UpdateCurrentTeamRequest {
	return model.UpdateCurrentTeamRequest{Name: req.Name}
}

func createPenaltyRuleRequestFromAPI(req api.CreatePenaltyRuleRequest) model.CreatePenaltyRuleRequest {
	return model.CreatePenaltyRuleRequest{
		Description: req.Description,
		Name:        req.Name,
		Threshold:   req.Threshold,
	}
}

func updatePenaltyRuleRequestFromAPI(req api.UpdatePenaltyRuleRequest) model.UpdatePenaltyRuleRequest {
	return model.UpdatePenaltyRuleRequest{
		Description: req.Description,
		Name:        req.Name,
		Threshold:   req.Threshold,
	}
}

func createShoppingItemRequestFromAPI(req api.CreateShoppingListItemRequest) model.CreateShoppingListItemRequest {
	return model.CreateShoppingListItemRequest{Name: req.Name, Notes: req.Notes}
}

func updateShoppingItemRequestFromAPI(req api.UpdateShoppingListItemRequest) model.UpdateShoppingListItemRequest {
	return model.UpdateShoppingListItemRequest{Name: req.Name, Notes: req.Notes}
}

func reorderShoppingItemsRequestFromAPI(req api.ReorderShoppingListItemsRequest) model.ReorderShoppingListItemsRequest {
	return model.ReorderShoppingListItemsRequest{ItemIds: slices.Clone(req.ItemIds)}
}

func createReminderRequestFromAPI(req api.CreateReminderRequest) model.CreateReminderRequest {
	return model.CreateReminderRequest{
		EndDate:      datePtrFromAPI(req.EndDate),
		Kind:         model.ReminderKind(req.Kind),
		Notes:        req.Notes,
		ScheduleType: reminderScheduleTypePtrFromAPI(req.ScheduleType),
		StartDate:    model.Date{Time: req.StartDate.Time},
		Title:        req.Title,
	}
}

func updateReminderRequestFromAPI(req api.UpdateReminderRequest) model.UpdateReminderRequest {
	var kind *model.ReminderKind
	if req.Kind != nil {
		mapped := model.ReminderKind(*req.Kind)
		kind = &mapped
	}
	return model.UpdateReminderRequest{
		EndDate:      datePtrFromAPI(req.EndDate),
		Kind:         kind,
		Notes:        req.Notes,
		ScheduleType: reminderScheduleTypePtrFromAPI(req.ScheduleType),
		StartDate:    datePtrFromAPI(req.StartDate),
		Title:        req.Title,
	}
}

func datePtrFromAPI(value *openapi_types.Date) *model.Date {
	if value == nil {
		return nil
	}
	return &model.Date{Time: value.Time}
}

func reminderScheduleTypePtrFromAPI(value *api.ReminderScheduleType) *model.ReminderScheduleType {
	if value == nil {
		return nil
	}
	mapped := model.ReminderScheduleType(*value)
	return &mapped
}

func upsertPushSubscriptionRequestFromAPI(req api.UpsertPushSubscriptionRequest) model.UpsertPushSubscriptionRequest {
	return model.UpsertPushSubscriptionRequest{
		Endpoint: req.Endpoint,
		Keys: model.PushSubscriptionKeys{
			Auth:   req.Keys.Auth,
			P256dh: req.Keys.P256dh,
		},
		Platform:  model.PushPlatform(req.Platform),
		UserAgent: req.UserAgent,
	}
}
