package repositories

import (
	"context"
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	"github.com/megu/kaji-challenge/backend/internal/application/ports"
	"github.com/megu/kaji-challenge/backend/internal/application/usecases"
)

type Store interface {
	AuthStore
	TeamStore
	PushStore
	TaskStore
	PenaltyStore
	ShoppingListStore
	ReminderStore
	TaskOverviewStore
	AdminStore
}

type AuthStore interface {
	StartGoogleAuth(ctx context.Context) (model.AuthStartResponse, error)
	CompleteGoogleAuth(ctx context.Context, code, state, mockEmail, mockName, mockSub, mockIss string) (string, string, error)
	ExchangeSession(ctx context.Context, exchangeCode string) (ports.AuthSession, error)
	RevokeSession(ctx context.Context, token string)
	LookupSession(ctx context.Context, token string) (string, bool)
}

type TeamStore interface {
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

type PushStore interface {
	UpsertPushSubscription(ctx context.Context, userID string, req model.UpsertPushSubscriptionRequest) (model.PushSubscription, error)
	DeletePushSubscription(ctx context.Context, userID, subscriptionID string) error
	ListPushSubscriptions(ctx context.Context, userID string) (model.ListPushSubscriptionsResponse, error)
	ListPushTeamIDs(ctx context.Context) ([]string, error)
	ListPendingPushTasks(ctx context.Context, teamID string, taskType model.TaskType, now, slotDate time.Time) ([]ports.PendingPushTask, error)
	ListActivePushSubscriptions(ctx context.Context, teamID string) ([]ports.PushSubscriptionTarget, error)
	DeactivatePushSubscriptionByEndpoint(ctx context.Context, endpoint string, updatedAt time.Time) error
	Now() time.Time
}

type TaskStore interface {
	ListTasks(ctx context.Context, userID string, filter *model.TaskType) ([]model.Task, error)
	CreateTask(ctx context.Context, userID string, req model.CreateTaskRequest) (model.Task, error)
	PatchTask(ctx context.Context, userID, taskID string, req model.UpdateTaskRequest) (model.Task, error)
	DeleteTask(ctx context.Context, userID, taskID string) error
	ReorderTasks(ctx context.Context, userID string, req model.ReorderTasksRequest) ([]model.Task, error)
	ToggleTaskCompletion(ctx context.Context, userID, taskID string, target time.Time, action *model.ToggleTaskCompletionRequestAction) (model.TaskCompletionResponse, error)
}

type PenaltyStore interface {
	ListPenaltyRules(ctx context.Context, userID string, includeDeleted bool) ([]model.PenaltyRule, error)
	CreatePenaltyRule(ctx context.Context, userID string, req model.CreatePenaltyRuleRequest) (model.PenaltyRule, error)
	PatchPenaltyRule(ctx context.Context, userID, ruleID string, req model.UpdatePenaltyRuleRequest) (model.PenaltyRule, error)
	DeletePenaltyRule(ctx context.Context, userID, ruleID string) error
}

type ShoppingListStore interface {
	ListShoppingItems(ctx context.Context, userID string) ([]model.ShoppingListItem, error)
	CreateShoppingItem(ctx context.Context, userID string, req model.CreateShoppingListItemRequest) (model.ShoppingListItem, error)
	PatchShoppingItem(ctx context.Context, userID, itemID string, req model.UpdateShoppingListItemRequest) (model.ShoppingListItem, error)
	DeleteShoppingItem(ctx context.Context, userID, itemID string) error
	ReorderShoppingItems(ctx context.Context, userID string, req model.ReorderShoppingListItemsRequest) ([]model.ShoppingListItem, error)
}

type ReminderStore interface {
	ListReminders(ctx context.Context, userID string, from, to time.Time) ([]model.ReminderCalendarDay, error)
	ListReminderDefinitions(ctx context.Context, userID string) ([]model.Reminder, error)
	CreateReminder(ctx context.Context, userID string, req model.CreateReminderRequest) (model.Reminder, error)
	PatchReminder(ctx context.Context, userID, reminderID string, req model.UpdateReminderRequest) (model.Reminder, error)
	DeleteReminder(ctx context.Context, userID, reminderID string) error
}

type TaskOverviewStore interface {
	GetTaskOverview(ctx context.Context, userID string) (model.TaskOverviewResponse, error)
	GetMonthlySummary(ctx context.Context, userID string, month *string) (model.MonthlyPenaltySummary, error)
}

type AdminStore interface {
	ListClosableTeamIDs(ctx context.Context) ([]string, error)
	PrimaryTeamID(ctx context.Context, userID string) (string, error)
	RunTeamRevisionCAS(ctx context.Context, teamID, entity string, hints map[string]string, fn func(context.Context) error) error
	NextDayCloseTarget(ctx context.Context, teamID string) (time.Time, bool, error)
	NextWeekCloseTarget(ctx context.Context, teamID string) (time.Time, bool, error)
	NextMonthCloseTarget(ctx context.Context, teamID string) (time.Time, bool, error)
	CloseDayTarget(ctx context.Context, teamID string, targetDate time.Time) (bool, error)
	CloseWeekTarget(ctx context.Context, teamID string, weekStart time.Time) (bool, error)
	CloseMonthTarget(ctx context.Context, teamID string, monthStart time.Time) (bool, string, error)
	Now() time.Time
	CloseDayForUser(ctx context.Context, userID string) (model.CloseResponse, error)
	CloseWeekForUser(ctx context.Context, userID string) (model.CloseResponse, error)
	CloseMonthForUser(ctx context.Context, userID string) (model.CloseResponse, error)
	CloseDayForTeam(ctx context.Context, teamID string) (model.CloseResponse, error)
	CloseWeekForTeam(ctx context.Context, teamID string) (model.CloseResponse, error)
	CloseMonthForTeam(ctx context.Context, teamID string) (model.CloseResponse, error)
}

type authRepo struct{ store AuthStore }
type teamRepo struct{ store TeamStore }
type pushRepo struct{ store PushStore }
type taskRepo struct{ store TaskStore }
type penaltyRepo struct{ store PenaltyStore }
type shoppingListRepo struct{ store ShoppingListStore }
type reminderRepo struct{ store ReminderStore }
type taskOverviewRepo struct{ store TaskOverviewStore }
type adminRepo struct{ store AdminStore }

func NewServices(s Store) *ports.Services {
	deps := ports.Dependencies{
		AuthRepo:         authRepo{store: s},
		TeamRepo:         teamRepo{store: s},
		PushRepo:         pushRepo{store: s},
		TaskRepo:         taskRepo{store: s},
		PenaltyRepo:      penaltyRepo{store: s},
		ShoppingListRepo: shoppingListRepo{store: s},
		ReminderRepo:     reminderRepo{store: s},
		TaskOverviewRepo: taskOverviewRepo{store: s},
		AdminRepo:        adminRepo{store: s},
	}
	return usecases.NewServices(deps)
}
