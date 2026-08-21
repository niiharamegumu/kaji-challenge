package transport

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/megu/kaji-challenge/backend/internal/application"
	"github.com/megu/kaji-challenge/backend/internal/application/model"
	"github.com/megu/kaji-challenge/backend/internal/application/ports"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

type mockAuthService struct{}

func (m mockAuthService) ValidateSettings() error { return nil }
func (m mockAuthService) StartGoogleAuth(context.Context) (model.AuthStartResponse, error) {
	return model.AuthStartResponse{}, nil
}
func (m mockAuthService) CompleteGoogleAuth(context.Context, string, string, string, string, string, string) (string, string, error) {
	return "", "", nil
}
func (m mockAuthService) ExchangeSession(context.Context, string) (ports.AuthSession, error) {
	return ports.AuthSession{}, nil
}
func (m mockAuthService) RevokeSession(context.Context, string)                {}
func (m mockAuthService) LookupSession(context.Context, string) (string, bool) { return "", false }

type mockTeamService struct{ err error }

func (m mockTeamService) GetMe(context.Context, string) (model.MeResponse, error) {
	if m.err != nil {
		return model.MeResponse{}, m.err
	}
	return model.MeResponse{}, nil
}
func (m mockTeamService) PatchMeNickname(context.Context, string, model.UpdateNicknameRequest) (model.UpdateNicknameResponse, error) {
	return model.UpdateNicknameResponse{}, nil
}
func (m mockTeamService) PatchMeColor(context.Context, string, model.UpdateColorRequest) (model.UpdateColorResponse, error) {
	return model.UpdateColorResponse{}, nil
}
func (m mockTeamService) CreateInvite(context.Context, string, model.CreateInviteRequest) (model.InviteCodeResponse, error) {
	return model.InviteCodeResponse{}, nil
}
func (m mockTeamService) GetTeamCurrentInvite(context.Context, string) (model.InviteCodeResponse, error) {
	return model.InviteCodeResponse{}, nil
}
func (m mockTeamService) PatchTeamCurrent(context.Context, string, model.UpdateCurrentTeamRequest) (model.TeamInfoResponse, error) {
	return model.TeamInfoResponse{}, nil
}
func (m mockTeamService) GetTeamCurrentMembers(context.Context, string) (model.TeamMembersResponse, error) {
	return model.TeamMembersResponse{}, nil
}
func (m mockTeamService) JoinTeam(context.Context, string, string) (model.JoinTeamResponse, error) {
	return model.JoinTeamResponse{}, nil
}
func (m mockTeamService) PostTeamLeave(context.Context, string) (model.JoinTeamResponse, error) {
	return model.JoinTeamResponse{}, nil
}

type mockPushService struct{}

func (m mockPushService) UpsertPushSubscription(context.Context, string, model.UpsertPushSubscriptionRequest) (model.PushSubscription, error) {
	return model.PushSubscription{}, nil
}
func (m mockPushService) DeletePushSubscription(context.Context, string, string) error {
	return nil
}
func (m mockPushService) ListPushSubscriptions(context.Context, string) (model.ListPushSubscriptionsResponse, error) {
	return model.ListPushSubscriptionsResponse{}, nil
}
func (m mockPushService) NotifySlot(context.Context, string, ports.PushSender) (ports.NotifyRunResult, error) {
	return ports.NotifyRunResult{}, nil
}

type mockTaskService struct{}

func (m mockTaskService) ListTasks(context.Context, string, *model.TaskType) ([]model.Task, error) {
	return nil, nil
}
func (m mockTaskService) CreateTask(context.Context, string, model.CreateTaskRequest) (model.Task, error) {
	return model.Task{}, nil
}
func (m mockTaskService) PatchTask(context.Context, string, string, model.UpdateTaskRequest) (model.Task, error) {
	return model.Task{}, nil
}
func (m mockTaskService) DeleteTask(context.Context, string, string) error { return nil }
func (m mockTaskService) ReorderTasks(context.Context, string, model.ReorderTasksRequest) ([]model.Task, error) {
	return nil, nil
}
func (m mockTaskService) ToggleTaskCompletion(context.Context, string, string, time.Time, *model.ToggleTaskCompletionRequestAction) (model.TaskCompletionResponse, error) {
	return model.TaskCompletionResponse{}, nil
}

type mockPenaltyService struct{}

func (m mockPenaltyService) ListPenaltyRules(context.Context, string, bool) ([]model.PenaltyRule, error) {
	return nil, nil
}
func (m mockPenaltyService) CreatePenaltyRule(context.Context, string, model.CreatePenaltyRuleRequest) (model.PenaltyRule, error) {
	return model.PenaltyRule{}, nil
}
func (m mockPenaltyService) PatchPenaltyRule(context.Context, string, string, model.UpdatePenaltyRuleRequest) (model.PenaltyRule, error) {
	return model.PenaltyRule{}, nil
}
func (m mockPenaltyService) DeletePenaltyRule(context.Context, string, string) error { return nil }

type mockShoppingListService struct{}

func (m mockShoppingListService) ListShoppingItems(context.Context, string) ([]model.ShoppingListItem, error) {
	return nil, nil
}
func (m mockShoppingListService) CreateShoppingItem(context.Context, string, model.CreateShoppingListItemRequest) (model.ShoppingListItem, error) {
	return model.ShoppingListItem{}, nil
}
func (m mockShoppingListService) PatchShoppingItem(context.Context, string, string, model.UpdateShoppingListItemRequest) (model.ShoppingListItem, error) {
	return model.ShoppingListItem{}, nil
}
func (m mockShoppingListService) DeleteShoppingItem(context.Context, string, string) error {
	return nil
}
func (m mockShoppingListService) ReorderShoppingItems(context.Context, string, model.ReorderShoppingListItemsRequest) ([]model.ShoppingListItem, error) {
	return nil, nil
}

type mockTaskOverviewService struct{}

func (m mockTaskOverviewService) GetTaskOverview(context.Context, string) (model.TaskOverviewResponse, error) {
	return model.TaskOverviewResponse{}, nil
}
func (m mockTaskOverviewService) GetMonthlySummary(context.Context, string, *string) (model.MonthlyPenaltySummary, error) {
	return model.MonthlyPenaltySummary{}, nil
}

type mockAdminService struct{}

func (m mockAdminService) ListClosableTeamIDs(context.Context) ([]string, error) {
	return nil, nil
}
func (m mockAdminService) GetMonthCloseCandidate(context.Context, string) (model.MonthCloseCandidateResponse, error) {
	return model.MonthCloseCandidateResponse{}, nil
}
func (m mockAdminService) CloseMonthForUserTarget(context.Context, string, string) (model.CloseResponse, error) {
	return model.CloseResponse{}, nil
}
func (m mockAdminService) CloseDayForTeam(context.Context, string) (model.CloseResponse, error) {
	return model.CloseResponse{}, nil
}
func (m mockAdminService) CloseWeekForTeam(context.Context, string) (model.CloseResponse, error) {
	return model.CloseResponse{}, nil
}

func newTestHandler(teamErr error) *Handler {
	return NewHandler(&ports.Services{
		Auth:         mockAuthService{},
		Team:         mockTeamService{err: teamErr},
		Push:         mockPushService{},
		Task:         mockTaskService{},
		Penalty:      mockPenaltyService{},
		ShoppingList: mockShoppingListService{},
		TaskOverview: mockTaskOverviewService{},
		Admin:        mockAdminService{},
	}, nil)
}

func TestGetMeMapsTypedNotFoundTo404(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := newTestHandler(application.ErrNotFound)
	r := gin.New()
	r.GET("/v1/me", func(c *gin.Context) {
		c.Set(AuthUserIDKey, "u1")
		h.GetMe(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)

	if res.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", res.Code)
	}
}

func TestPostTaskInvalidBodyReturns400(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := newTestHandler(nil)
	r := gin.New()
	r.POST("/v1/tasks", func(c *gin.Context) {
		c.Set(AuthUserIDKey, "u1")
		h.PostTask(c)
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/tasks", strings.NewReader("{"))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", res.Code)
	}

	var body map[string]string
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if body["message"] == "" {
		t.Fatalf("expected error message")
	}
}

func TestGetTaskOverviewWithoutUserReturns401(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := newTestHandler(nil)
	r := gin.New()
	r.GET("/v1/tasks/overview", h.GetTaskOverview)

	req := httptest.NewRequest(http.MethodGet, "/v1/tasks/overview", nil)
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)

	if res.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", res.Code)
	}
}

func TestPostShoppingItemsReorderInvalidBodyReturns400(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := newTestHandler(nil)
	r := gin.New()
	r.POST("/v1/shopping-items/reorder", func(c *gin.Context) {
		c.Set(AuthUserIDKey, "u1")
		h.PostShoppingItemsReorder(c, api.PostShoppingItemsReorderParams{})
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/shopping-items/reorder", strings.NewReader("{"))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", res.Code)
	}
}

func TestPostTasksReorderInvalidBodyReturns400(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := newTestHandler(nil)
	r := gin.New()
	r.POST("/v1/tasks/reorder", func(c *gin.Context) {
		c.Set(AuthUserIDKey, "u1")
		h.PostTasksReorder(c)
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/tasks/reorder", strings.NewReader("{"))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", res.Code)
	}
}
