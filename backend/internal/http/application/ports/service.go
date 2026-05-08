package ports

import (
	"context"
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/http/application/model"
)

type Services struct {
	Auth         AuthService
	Team         TeamService
	Push         PushService
	Task         TaskService
	Penalty      PenaltyService
	ShoppingList ShoppingListService
	Reminder     ReminderService
	TaskOverview TaskOverviewService
	Admin        AdminService
}

type AuthSession struct {
	Token string
	User  model.User
}

type AuthService interface {
	StartGoogleAuth(ctx context.Context) (model.AuthStartResponse, error)
	CompleteGoogleAuth(ctx context.Context, code, state, mockEmail, mockName, mockSub, mockIss string) (string, string, error)
	ExchangeSession(ctx context.Context, exchangeCode string) (AuthSession, error)
	RevokeSession(ctx context.Context, token string)
	LookupSession(ctx context.Context, token string) (string, bool)
}

type TeamService interface {
	GetMe(ctx context.Context, userID string) (model.MeResponse, error)
	PatchMeNickname(ctx context.Context, userID string, req model.UpdateNicknameRequest) (model.UpdateNicknameResponse, error)
	PatchMeColor(ctx context.Context, userID string, req model.UpdateColorRequest) (model.UpdateColorResponse, error)
	CreateInvite(ctx context.Context, userID string, req model.CreateInviteRequest) (model.InviteCodeResponse, error)
	GetTeamCurrentInvite(ctx context.Context, userID string) (model.InviteCodeResponse, error)
	PatchTeamCurrent(ctx context.Context, userID string, req model.UpdateCurrentTeamRequest) (model.TeamInfoResponse, error)
	GetTeamCurrentMembers(ctx context.Context, userID string) (model.TeamMembersResponse, error)
	JoinTeam(ctx context.Context, userID, code string) (model.JoinTeamResponse, error)
	PostTeamLeave(ctx context.Context, userID string) (model.JoinTeamResponse, error)
}

type PushService interface {
	UpsertPushSubscription(ctx context.Context, userID string, req model.UpsertPushSubscriptionRequest) (model.PushSubscription, error)
	DeletePushSubscription(ctx context.Context, userID, subscriptionID string) error
	ListPushSubscriptions(ctx context.Context, userID string) (model.ListPushSubscriptionsResponse, error)
}

type TaskService interface {
	ListTasks(ctx context.Context, userID string, filter *model.TaskType) ([]model.Task, error)
	CreateTask(ctx context.Context, userID string, req model.CreateTaskRequest) (model.Task, error)
	PatchTask(ctx context.Context, userID, taskID string, req model.UpdateTaskRequest) (model.Task, error)
	DeleteTask(ctx context.Context, userID, taskID string) error
	ReorderTasks(ctx context.Context, userID string, req model.ReorderTasksRequest) ([]model.Task, error)
	ToggleTaskCompletion(ctx context.Context, userID, taskID string, target time.Time, action *model.ToggleTaskCompletionRequestAction) (model.TaskCompletionResponse, error)
}

type PenaltyService interface {
	ListPenaltyRules(ctx context.Context, userID string, includeDeleted bool) ([]model.PenaltyRule, error)
	CreatePenaltyRule(ctx context.Context, userID string, req model.CreatePenaltyRuleRequest) (model.PenaltyRule, error)
	PatchPenaltyRule(ctx context.Context, userID, ruleID string, req model.UpdatePenaltyRuleRequest) (model.PenaltyRule, error)
	DeletePenaltyRule(ctx context.Context, userID, ruleID string) error
}

type ShoppingListService interface {
	ListShoppingItems(ctx context.Context, userID string) ([]model.ShoppingListItem, error)
	CreateShoppingItem(ctx context.Context, userID string, req model.CreateShoppingListItemRequest) (model.ShoppingListItem, error)
	PatchShoppingItem(ctx context.Context, userID, itemID string, req model.UpdateShoppingListItemRequest) (model.ShoppingListItem, error)
	DeleteShoppingItem(ctx context.Context, userID, itemID string) error
	ReorderShoppingItems(ctx context.Context, userID string, req model.ReorderShoppingListItemsRequest) ([]model.ShoppingListItem, error)
}

type ReminderService interface {
	ListReminders(ctx context.Context, userID string, from, to time.Time) ([]model.ReminderCalendarDay, error)
	ListReminderDefinitions(ctx context.Context, userID string) ([]model.Reminder, error)
	CreateReminder(ctx context.Context, userID string, req model.CreateReminderRequest) (model.Reminder, error)
	PatchReminder(ctx context.Context, userID, reminderID string, req model.UpdateReminderRequest) (model.Reminder, error)
	DeleteReminder(ctx context.Context, userID, reminderID string) error
}

type TaskOverviewService interface {
	GetTaskOverview(ctx context.Context, userID string) (model.TaskOverviewResponse, error)
	GetMonthlySummary(ctx context.Context, userID string, month *string) (model.MonthlyPenaltySummary, error)
}

type AdminService interface {
	CloseDayForUser(ctx context.Context, userID string) (model.CloseResponse, error)
	CloseWeekForUser(ctx context.Context, userID string) (model.CloseResponse, error)
	CloseMonthForUser(ctx context.Context, userID string) (model.CloseResponse, error)
}
