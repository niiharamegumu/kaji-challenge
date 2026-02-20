package ports

import (
	"context"
	"time"

	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

type Services struct {
	Auth         AuthService
	Team         TeamService
	Task         TaskService
	Penalty      PenaltyService
	TaskOverview TaskOverviewService
	Admin        AdminService
}

type AuthSession struct {
	Token string
	User  api.User
}

type AuthService interface {
	StartGoogleAuth(ctx context.Context) (api.AuthStartResponse, error)
	CompleteGoogleAuth(ctx context.Context, code, state, mockEmail, mockName, mockSub string) (string, string, error)
	ExchangeSession(ctx context.Context, exchangeCode string) (AuthSession, error)
	RevokeSession(ctx context.Context, token string)
	LookupSession(ctx context.Context, token string) (string, bool)
}

type TeamService interface {
	GetMe(ctx context.Context, userID string) (api.MeResponse, error)
	CreateInvite(ctx context.Context, userID string, req api.CreateInviteRequest) (api.InviteCodeResponse, error)
	JoinTeam(ctx context.Context, userID, code string) (api.JoinTeamResponse, error)
}

type TaskService interface {
	ListTasks(ctx context.Context, userID string, filter *api.TaskType) ([]api.Task, error)
	CreateTask(ctx context.Context, userID string, req api.CreateTaskRequest) (api.Task, error)
	PatchTask(ctx context.Context, userID, taskID string, req api.UpdateTaskRequest) (api.Task, error)
	DeleteTask(ctx context.Context, userID, taskID string) error
	ToggleTaskCompletion(ctx context.Context, userID, taskID string, target time.Time, action *api.ToggleTaskCompletionRequestAction) (api.TaskCompletionResponse, error)
}

type PenaltyService interface {
	ListPenaltyRules(ctx context.Context, userID string) ([]api.PenaltyRule, error)
	CreatePenaltyRule(ctx context.Context, userID string, req api.CreatePenaltyRuleRequest) (api.PenaltyRule, error)
	PatchPenaltyRule(ctx context.Context, userID, ruleID string, req api.UpdatePenaltyRuleRequest) (api.PenaltyRule, error)
	DeletePenaltyRule(ctx context.Context, userID, ruleID string) error
}

type TaskOverviewService interface {
	GetTaskOverview(ctx context.Context, userID string) (api.TaskOverviewResponse, error)
	GetMonthlySummary(ctx context.Context, userID string, month *string) (api.MonthlyPenaltySummary, error)
}

type AdminService interface {
	CloseDayForUser(ctx context.Context, userID string) (api.CloseResponse, error)
	CloseWeekForUser(ctx context.Context, userID string) (api.CloseResponse, error)
	CloseMonthForUser(ctx context.Context, userID string) (api.CloseResponse, error)
}
