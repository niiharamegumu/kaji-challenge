package infra

import (
	"context"
	"time"

	"github.com/megu/kaji-challenge/backend/internal/http/application"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

type authService struct{ store *store }
type teamService struct{ store *store }
type taskService struct{ store *store }
type penaltyService struct{ store *store }
type homeService struct{ store *store }
type adminService struct{ store *store }

func NewStore() *store {
	return newStore()
}

func NewServices(s *store) *application.Services {
	return &application.Services{
		Auth:    authService{store: s},
		Team:    teamService{store: s},
		Task:    taskService{store: s},
		Penalty: penaltyService{store: s},
		Home:    homeService{store: s},
		Admin:   adminService{store: s},
	}
}

func (s authService) StartGoogleAuth(ctx context.Context) (api.AuthStartResponse, error) {
	return s.store.startGoogleAuth(ctx)
}

func (s authService) CompleteGoogleAuth(ctx context.Context, code, state, mockEmail, mockName, mockSub string) (string, string, error) {
	return s.store.completeGoogleAuth(ctx, code, state, mockEmail, mockName, mockSub)
}

func (s authService) ExchangeSession(ctx context.Context, exchangeCode string) (api.AuthSessionResponse, error) {
	return s.store.exchangeSession(ctx, exchangeCode)
}

func (s authService) RevokeSession(ctx context.Context, token string) {
	s.store.revokeSession(ctx, token)
}

func (s authService) LookupSession(ctx context.Context, token string) (string, bool) {
	return s.store.lookupSession(ctx, token)
}

func (s teamService) GetMe(ctx context.Context, userID string) (api.MeResponse, error) {
	user, memberships, err := s.store.currentUserAndMemberships(ctx, userID)
	if err != nil {
		return api.MeResponse{}, err
	}
	return api.MeResponse{User: user.toAPI(), Memberships: memberships}, nil
}

func (s teamService) CreateInvite(ctx context.Context, userID string, req api.CreateInviteRequest) (api.InviteCodeResponse, error) {
	return s.store.createInvite(ctx, userID, req)
}

func (s teamService) JoinTeam(ctx context.Context, userID, code string) (api.JoinTeamResponse, error) {
	return s.store.joinTeam(ctx, userID, code)
}

func (s taskService) ListTasks(ctx context.Context, userID string, filter *api.TaskType) ([]api.Task, error) {
	return s.store.listTasks(ctx, userID, filter)
}

func (s taskService) CreateTask(ctx context.Context, userID string, req api.CreateTaskRequest) (api.Task, error) {
	return s.store.createTask(ctx, userID, req)
}

func (s taskService) PatchTask(ctx context.Context, userID, taskID string, req api.UpdateTaskRequest) (api.Task, error) {
	return s.store.patchTask(ctx, userID, taskID, req)
}

func (s taskService) DeleteTask(ctx context.Context, userID, taskID string) error {
	return s.store.deleteTask(ctx, userID, taskID)
}

func (s taskService) ToggleTaskCompletion(ctx context.Context, userID, taskID string, target time.Time) (api.TaskCompletionResponse, error) {
	return s.store.toggleTaskCompletion(ctx, userID, taskID, target)
}

func (s penaltyService) ListPenaltyRules(ctx context.Context, userID string) ([]api.PenaltyRule, error) {
	return s.store.listPenaltyRules(ctx, userID)
}

func (s penaltyService) CreatePenaltyRule(ctx context.Context, userID string, req api.CreatePenaltyRuleRequest) (api.PenaltyRule, error) {
	return s.store.createPenaltyRule(ctx, userID, req)
}

func (s penaltyService) PatchPenaltyRule(ctx context.Context, userID, ruleID string, req api.UpdatePenaltyRuleRequest) (api.PenaltyRule, error) {
	return s.store.patchPenaltyRule(ctx, userID, ruleID, req)
}

func (s penaltyService) DeletePenaltyRule(ctx context.Context, userID, ruleID string) error {
	return s.store.deletePenaltyRule(ctx, userID, ruleID)
}

func (s homeService) GetHome(ctx context.Context, userID string) (api.HomeResponse, error) {
	return s.store.getHome(ctx, userID)
}

func (s homeService) GetMonthlySummary(ctx context.Context, userID string, month *string) (api.MonthlyPenaltySummary, error) {
	return s.store.getMonthlySummary(ctx, userID, month)
}

func (s adminService) CloseDayForUser(ctx context.Context, userID string) (api.CloseResponse, error) {
	return s.store.closeDayForUser(ctx, userID)
}

func (s adminService) CloseWeekForUser(ctx context.Context, userID string) (api.CloseResponse, error) {
	return s.store.closeWeekForUser(ctx, userID)
}

func (s adminService) CloseMonthForUser(ctx context.Context, userID string) (api.CloseResponse, error) {
	return s.store.closeMonthForUser(ctx, userID)
}

// RejectMockParamsInStrictModeForTest is used by router tests without exposing internal store types.
func RejectMockParamsInStrictModeForTest(ctx context.Context, loc *time.Location) error {
	if loc == nil {
		loc = time.FixedZone("JST", 9*60*60)
	}
	s := &store{
		loc:          loc,
		authRequests: map[string]authRequest{},
	}
	s.authRequests["state-1"] = authRequest{
		Nonce:        "nonce-1",
		CodeVerifier: "verifier-1",
		ExpiresAt:    time.Now().In(loc).Add(10 * time.Minute),
	}
	_, _, err := s.completeGoogleAuth(ctx, "mock-code", "state-1", "owner@example.com", "Owner", "")
	return err
}
