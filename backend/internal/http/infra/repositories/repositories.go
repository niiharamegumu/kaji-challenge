package repositories

import (
	"context"
	"time"

	"github.com/megu/kaji-challenge/backend/internal/http/application/ports"
	"github.com/megu/kaji-challenge/backend/internal/http/application/usecases"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

type Store interface {
	StartGoogleAuth(ctx context.Context) (api.AuthStartResponse, error)
	CompleteGoogleAuth(ctx context.Context, code, state, mockEmail, mockName, mockSub string) (string, string, error)
	ExchangeSession(ctx context.Context, exchangeCode string) (api.AuthSessionResponse, error)
	RevokeSession(ctx context.Context, token string)
	LookupSession(ctx context.Context, token string) (string, bool)

	GetMe(ctx context.Context, userID string) (api.MeResponse, error)
	CreateInvite(ctx context.Context, userID string, req api.CreateInviteRequest) (api.InviteCodeResponse, error)
	JoinTeam(ctx context.Context, userID, code string) (api.JoinTeamResponse, error)

	ListTasks(ctx context.Context, userID string, filter *api.TaskType) ([]api.Task, error)
	CreateTask(ctx context.Context, userID string, req api.CreateTaskRequest) (api.Task, error)
	PatchTask(ctx context.Context, userID, taskID string, req api.UpdateTaskRequest) (api.Task, error)
	DeleteTask(ctx context.Context, userID, taskID string) error
	ToggleTaskCompletion(ctx context.Context, userID, taskID string, target time.Time) (api.TaskCompletionResponse, error)

	ListPenaltyRules(ctx context.Context, userID string) ([]api.PenaltyRule, error)
	CreatePenaltyRule(ctx context.Context, userID string, req api.CreatePenaltyRuleRequest) (api.PenaltyRule, error)
	PatchPenaltyRule(ctx context.Context, userID, ruleID string, req api.UpdatePenaltyRuleRequest) (api.PenaltyRule, error)
	DeletePenaltyRule(ctx context.Context, userID, ruleID string) error

	GetHome(ctx context.Context, userID string) (api.HomeResponse, error)
	GetMonthlySummary(ctx context.Context, userID string, month *string) (api.MonthlyPenaltySummary, error)

	CloseDayForUser(ctx context.Context, userID string) (api.CloseResponse, error)
	CloseWeekForUser(ctx context.Context, userID string) (api.CloseResponse, error)
	CloseMonthForUser(ctx context.Context, userID string) (api.CloseResponse, error)
}

type authRepo struct{ store Store }
type teamRepo struct{ store Store }
type taskRepo struct{ store Store }
type penaltyRepo struct{ store Store }
type homeRepo struct{ store Store }
type adminRepo struct{ store Store }

func NewServices(s Store) *ports.Services {
	deps := ports.Dependencies{
		AuthRepo:    authRepo{store: s},
		TeamRepo:    teamRepo{store: s},
		TaskRepo:    taskRepo{store: s},
		PenaltyRepo: penaltyRepo{store: s},
		HomeRepo:    homeRepo{store: s},
		AdminRepo:   adminRepo{store: s},
	}
	return usecases.NewServices(deps)
}
