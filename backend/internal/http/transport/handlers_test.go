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
	"github.com/megu/kaji-challenge/backend/internal/http/application"
	"github.com/megu/kaji-challenge/backend/internal/http/application/ports"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

type mockAuthService struct{}

func (m mockAuthService) StartGoogleAuth(context.Context) (api.AuthStartResponse, error) {
	return api.AuthStartResponse{}, nil
}
func (m mockAuthService) CompleteGoogleAuth(context.Context, string, string, string, string, string) (string, string, error) {
	return "", "", nil
}
func (m mockAuthService) ExchangeSession(context.Context, string) (ports.AuthSession, error) {
	return ports.AuthSession{}, nil
}
func (m mockAuthService) RevokeSession(context.Context, string)                {}
func (m mockAuthService) LookupSession(context.Context, string) (string, bool) { return "", false }

type mockTeamService struct{ err error }

func (m mockTeamService) GetMe(context.Context, string) (api.MeResponse, error) {
	if m.err != nil {
		return api.MeResponse{}, m.err
	}
	return api.MeResponse{}, nil
}
func (m mockTeamService) PatchMeNickname(context.Context, string, api.UpdateNicknameRequest) (api.UpdateNicknameResponse, error) {
	return api.UpdateNicknameResponse{}, nil
}
func (m mockTeamService) CreateInvite(context.Context, string, api.CreateInviteRequest) (api.InviteCodeResponse, error) {
	return api.InviteCodeResponse{}, nil
}
func (m mockTeamService) GetTeamCurrentInvite(context.Context, string) (api.InviteCodeResponse, error) {
	return api.InviteCodeResponse{}, nil
}
func (m mockTeamService) PatchTeamCurrent(context.Context, string, api.UpdateCurrentTeamRequest) (api.TeamInfoResponse, error) {
	return api.TeamInfoResponse{}, nil
}
func (m mockTeamService) GetTeamCurrentMembers(context.Context, string) (api.TeamMembersResponse, error) {
	return api.TeamMembersResponse{}, nil
}
func (m mockTeamService) JoinTeam(context.Context, string, string) (api.JoinTeamResponse, error) {
	return api.JoinTeamResponse{}, nil
}
func (m mockTeamService) PostTeamLeave(context.Context, string) (api.JoinTeamResponse, error) {
	return api.JoinTeamResponse{}, nil
}

type mockTaskService struct{}

func (m mockTaskService) ListTasks(context.Context, string, *api.TaskType) ([]api.Task, error) {
	return nil, nil
}
func (m mockTaskService) CreateTask(context.Context, string, api.CreateTaskRequest) (api.Task, error) {
	return api.Task{}, nil
}
func (m mockTaskService) PatchTask(context.Context, string, string, api.UpdateTaskRequest) (api.Task, error) {
	return api.Task{}, nil
}
func (m mockTaskService) DeleteTask(context.Context, string, string) error { return nil }
func (m mockTaskService) ToggleTaskCompletion(context.Context, string, string, time.Time, *api.ToggleTaskCompletionRequestAction) (api.TaskCompletionResponse, error) {
	return api.TaskCompletionResponse{}, nil
}

type mockPenaltyService struct{}

func (m mockPenaltyService) ListPenaltyRules(context.Context, string) ([]api.PenaltyRule, error) {
	return nil, nil
}
func (m mockPenaltyService) CreatePenaltyRule(context.Context, string, api.CreatePenaltyRuleRequest) (api.PenaltyRule, error) {
	return api.PenaltyRule{}, nil
}
func (m mockPenaltyService) PatchPenaltyRule(context.Context, string, string, api.UpdatePenaltyRuleRequest) (api.PenaltyRule, error) {
	return api.PenaltyRule{}, nil
}
func (m mockPenaltyService) DeletePenaltyRule(context.Context, string, string) error { return nil }

type mockTaskOverviewService struct{}

func (m mockTaskOverviewService) GetTaskOverview(context.Context, string) (api.TaskOverviewResponse, error) {
	return api.TaskOverviewResponse{}, nil
}
func (m mockTaskOverviewService) GetMonthlySummary(context.Context, string, *string) (api.MonthlyPenaltySummary, error) {
	return api.MonthlyPenaltySummary{}, nil
}

type mockAdminService struct{}

func (m mockAdminService) CloseDayForUser(context.Context, string) (api.CloseResponse, error) {
	return api.CloseResponse{}, nil
}
func (m mockAdminService) CloseWeekForUser(context.Context, string) (api.CloseResponse, error) {
	return api.CloseResponse{}, nil
}
func (m mockAdminService) CloseMonthForUser(context.Context, string) (api.CloseResponse, error) {
	return api.CloseResponse{}, nil
}

func newTestHandler(teamErr error) *Handler {
	return NewHandler(&ports.Services{
		Auth:         mockAuthService{},
		Team:         mockTeamService{err: teamErr},
		Task:         mockTaskService{},
		Penalty:      mockPenaltyService{},
		TaskOverview: mockTaskOverviewService{},
		Admin:        mockAdminService{},
	})
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
