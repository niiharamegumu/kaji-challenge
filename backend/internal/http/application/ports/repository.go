package ports

import (
	"context"
	"time"

	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

type AuthRepository interface {
	StartGoogleAuth(ctx context.Context) (api.AuthStartResponse, error)
	CompleteGoogleAuth(ctx context.Context, code, state, mockEmail, mockName, mockSub, mockIss string) (string, string, error)
	ExchangeSession(ctx context.Context, exchangeCode string) (AuthSession, error)
	RevokeSession(ctx context.Context, token string)
	LookupSession(ctx context.Context, token string) (string, bool)
}

type TeamRepository interface {
	GetMe(ctx context.Context, userID string) (api.MeResponse, error)
	PatchMeNickname(ctx context.Context, userID string, req api.UpdateNicknameRequest) (api.UpdateNicknameResponse, error)
	PatchMeColor(ctx context.Context, userID string, req api.UpdateColorRequest) (api.UpdateColorResponse, error)
	CreateInvite(ctx context.Context, userID string, req api.CreateInviteRequest) (api.InviteCodeResponse, error)
	GetTeamCurrentInvite(ctx context.Context, userID string) (api.InviteCodeResponse, error)
	PatchTeamCurrent(ctx context.Context, userID string, req api.UpdateCurrentTeamRequest) (api.TeamInfoResponse, error)
	GetTeamCurrentMembers(ctx context.Context, userID string) (api.TeamMembersResponse, error)
	JoinTeam(ctx context.Context, userID, code string) (api.JoinTeamResponse, error)
	PostTeamLeave(ctx context.Context, userID string) (api.JoinTeamResponse, error)
}

type TaskRepository interface {
	ListTasks(ctx context.Context, userID string, filter *api.TaskType) ([]api.Task, error)
	CreateTask(ctx context.Context, userID string, req api.CreateTaskRequest) (api.Task, error)
	PatchTask(ctx context.Context, userID, taskID string, req api.UpdateTaskRequest) (api.Task, error)
	DeleteTask(ctx context.Context, userID, taskID string) error
	ToggleTaskCompletion(ctx context.Context, userID, taskID string, target time.Time, action *api.ToggleTaskCompletionRequestAction) (api.TaskCompletionResponse, error)
}

type PenaltyRepository interface {
	ListPenaltyRules(ctx context.Context, userID string, includeDeleted bool) ([]api.PenaltyRule, error)
	CreatePenaltyRule(ctx context.Context, userID string, req api.CreatePenaltyRuleRequest) (api.PenaltyRule, error)
	PatchPenaltyRule(ctx context.Context, userID, ruleID string, req api.UpdatePenaltyRuleRequest) (api.PenaltyRule, error)
	DeletePenaltyRule(ctx context.Context, userID, ruleID string) error
}

type ShoppingListRepository interface {
	ListShoppingItems(ctx context.Context, userID string) ([]api.ShoppingListItem, error)
	CreateShoppingItem(ctx context.Context, userID string, req api.CreateShoppingListItemRequest) (api.ShoppingListItem, error)
	PatchShoppingItem(ctx context.Context, userID, itemID string, req api.UpdateShoppingListItemRequest) (api.ShoppingListItem, error)
	DeleteShoppingItem(ctx context.Context, userID, itemID string) error
	ReorderShoppingItems(ctx context.Context, userID string, req api.ReorderShoppingListItemsRequest) ([]api.ShoppingListItem, error)
}

type ReminderRepository interface {
	ListReminders(ctx context.Context, userID string, from, to time.Time) ([]api.ReminderCalendarDay, error)
	ListReminderDefinitions(ctx context.Context, userID string) ([]api.Reminder, error)
	CreateReminder(ctx context.Context, userID string, req api.CreateReminderRequest) (api.Reminder, error)
	PatchReminder(ctx context.Context, userID, reminderID string, req api.UpdateReminderRequest) (api.Reminder, error)
	DeleteReminder(ctx context.Context, userID, reminderID string) error
}

type TaskOverviewRepository interface {
	GetTaskOverview(ctx context.Context, userID string) (api.TaskOverviewResponse, error)
	GetMonthlySummary(ctx context.Context, userID string, month *string) (api.MonthlyPenaltySummary, error)
}

type AdminRepository interface {
	CloseDayForUser(ctx context.Context, userID string) (api.CloseResponse, error)
	CloseWeekForUser(ctx context.Context, userID string) (api.CloseResponse, error)
	CloseMonthForUser(ctx context.Context, userID string) (api.CloseResponse, error)
}

type Dependencies struct {
	AuthRepo         AuthRepository
	TeamRepo         TeamRepository
	TaskRepo         TaskRepository
	PenaltyRepo      PenaltyRepository
	ShoppingListRepo ShoppingListRepository
	ReminderRepo     ReminderRepository
	TaskOverviewRepo TaskOverviewRepository
	AdminRepo        AdminRepository
}
