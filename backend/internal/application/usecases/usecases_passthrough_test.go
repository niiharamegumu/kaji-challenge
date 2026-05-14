package usecases

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
	"github.com/megu/kaji-challenge/backend/internal/application/ports"
)

type fakeAuthRepo struct {
	authReq           ports.AuthRequest
	createdRequests   []ports.AuthRequest
	createdState      string
	authUser          ports.AuthUserResult
	exchangeCode      string
	exchangeExpiresAt time.Time
	session           ports.AuthSession
	lookupUserID      string
	lookupOK          bool
	revokedToken      string
	err               error
}

func (f *fakeAuthRepo) CreateAuthRequest(_ context.Context, state, nonce, codeVerifier string, expiresAt time.Time) error {
	f.createdState = state
	f.createdRequests = append(f.createdRequests, ports.AuthRequest{Nonce: nonce, CodeVerifier: codeVerifier, ExpiresAt: expiresAt})
	return f.err
}

func (f *fakeAuthRepo) ConsumeAuthRequest(context.Context, string, time.Time) (ports.AuthRequest, error) {
	return f.authReq, f.err
}

func (f *fakeAuthRepo) GetOrCreateAuthUser(context.Context, string, string, string, string) (ports.AuthUserResult, error) {
	return f.authUser, f.err
}

func (f *fakeAuthRepo) CreateExchangeCode(_ context.Context, userID string, expiresAt time.Time) (string, error) {
	f.exchangeExpiresAt = expiresAt
	if f.exchangeCode == "" {
		return "exchange-" + userID, f.err
	}
	return f.exchangeCode, f.err
}

func (f *fakeAuthRepo) ExchangeSession(context.Context, string) (ports.AuthSession, error) {
	return f.session, f.err
}

func (f *fakeAuthRepo) RevokeSession(_ context.Context, token string) {
	f.revokedToken = token
}

func (f *fakeAuthRepo) LookupSession(context.Context, string) (string, bool) {
	return f.lookupUserID, f.lookupOK
}

type fakeOIDCProvider struct {
	configured  bool
	strict      bool
	validateErr error
	claims      ports.OIDCClaims
	err         error

	authState        string
	authNonce        string
	authVerifier     string
	exchangeCode     string
	exchangeVerifier string
}

func (f *fakeOIDCProvider) Configured() bool        { return f.configured }
func (f *fakeOIDCProvider) StrictMode() bool        { return f.strict }
func (f *fakeOIDCProvider) ValidateSettings() error { return f.validateErr }
func (f *fakeOIDCProvider) MockAuthorizationURL(state string) string {
	return "https://mock.example.test/callback?state=" + state
}
func (f *fakeOIDCProvider) AuthorizationURL(_ context.Context, state, nonce, verifier string) (string, error) {
	f.authState = state
	f.authNonce = nonce
	f.authVerifier = verifier
	return "https://issuer.example.test/auth?state=" + state, f.err
}
func (f *fakeOIDCProvider) ExchangeAndVerify(_ context.Context, code, verifier string) (ports.OIDCClaims, error) {
	f.exchangeCode = code
	f.exchangeVerifier = verifier
	return f.claims, f.err
}

type fakeTaskRepo struct {
	err   error
	task  model.Task
	items []model.Task
	resp  model.TaskCompletionResponse
}

func (f fakeTaskRepo) ListTasks(context.Context, string, *model.TaskType) ([]model.Task, error) {
	return f.items, f.err
}
func (f fakeTaskRepo) CreateTask(context.Context, string, model.CreateTaskRequest) (model.Task, error) {
	return f.task, f.err
}
func (f fakeTaskRepo) PatchTask(context.Context, string, string, model.UpdateTaskRequest) (model.Task, error) {
	return f.task, f.err
}
func (f fakeTaskRepo) DeleteTask(context.Context, string, string) error { return f.err }
func (f fakeTaskRepo) ReorderTasks(context.Context, string, model.ReorderTasksRequest) ([]model.Task, error) {
	return f.items, f.err
}
func (f fakeTaskRepo) ToggleTaskCompletion(context.Context, string, string, time.Time, *model.ToggleTaskCompletionRequestAction) (model.TaskCompletionResponse, error) {
	return f.resp, f.err
}

type fakeShoppingRepo struct {
	err   error
	item  model.ShoppingListItem
	items []model.ShoppingListItem
}

func (f fakeShoppingRepo) ListShoppingItems(context.Context, string) ([]model.ShoppingListItem, error) {
	return f.items, f.err
}
func (f fakeShoppingRepo) CreateShoppingItem(context.Context, string, model.CreateShoppingListItemRequest) (model.ShoppingListItem, error) {
	return f.item, f.err
}
func (f fakeShoppingRepo) PatchShoppingItem(context.Context, string, string, model.UpdateShoppingListItemRequest) (model.ShoppingListItem, error) {
	return f.item, f.err
}
func (f fakeShoppingRepo) DeleteShoppingItem(context.Context, string, string) error { return f.err }
func (f fakeShoppingRepo) ReorderShoppingItems(context.Context, string, model.ReorderShoppingListItemsRequest) ([]model.ShoppingListItem, error) {
	return f.items, f.err
}

func TestAuthStartGoogleAuthUsesDefaultMockURLWhenOIDCIsNil(t *testing.T) {
	t.Setenv("APP_BASE_URL", "https://app.example.test")
	repo := &fakeAuthRepo{}
	uc := authUsecase{repo: repo}

	res, err := uc.StartGoogleAuth(context.Background())
	if err != nil {
		t.Fatalf("StartGoogleAuth failed: %v", err)
	}
	if len(repo.createdRequests) != 1 {
		t.Fatalf("expected one auth request, got %d", len(repo.createdRequests))
	}
	if repo.createdRequests[0].Nonce == "" || repo.createdRequests[0].CodeVerifier == "" || repo.createdState == "" {
		t.Fatalf("expected generated auth request, got state=%q request=%+v", repo.createdState, repo.createdRequests[0])
	}
	if !strings.HasPrefix(res.AuthorizationUrl, "https://app.example.test/v1/auth/google/callback?") {
		t.Fatalf("unexpected mock authorization URL: %s", res.AuthorizationUrl)
	}
	if !strings.Contains(res.AuthorizationUrl, "state="+repo.createdState) {
		t.Fatalf("authorization URL does not include generated state: %s", res.AuthorizationUrl)
	}
}

func TestAuthStartGoogleAuthUsesConfiguredOIDCProvider(t *testing.T) {
	repo := &fakeAuthRepo{}
	oidc := &fakeOIDCProvider{configured: true}
	uc := authUsecase{repo: repo, oidc: oidc}

	res, err := uc.StartGoogleAuth(context.Background())
	if err != nil {
		t.Fatalf("StartGoogleAuth failed: %v", err)
	}
	if !strings.HasPrefix(res.AuthorizationUrl, "https://issuer.example.test/auth?state=") {
		t.Fatalf("unexpected OIDC authorization URL: %s", res.AuthorizationUrl)
	}
	if oidc.authState != repo.createdState || oidc.authNonce == "" || oidc.authVerifier == "" {
		t.Fatalf("expected generated params to be passed to OIDC provider, state=%q nonce=%q verifier=%q", oidc.authState, oidc.authNonce, oidc.authVerifier)
	}
}

func TestAuthStartGoogleAuthRejectsStrictModeWithoutOIDCConfig(t *testing.T) {
	repo := &fakeAuthRepo{}
	uc := authUsecase{repo: repo, oidc: &fakeOIDCProvider{strict: true}}

	if _, err := uc.StartGoogleAuth(context.Background()); err == nil {
		t.Fatal("expected strict mode without OIDC config to fail")
	}
}

func TestAuthCompleteGoogleAuthAcceptsMockCallbackParams(t *testing.T) {
	t.Setenv("FRONTEND_CALLBACK_URL", "https://frontend.example.test/callback")
	repo := &fakeAuthRepo{
		authReq:      ports.AuthRequest{Nonce: "nonce-1", CodeVerifier: "verifier-1"},
		authUser:     ports.AuthUserResult{UserID: "user-1"},
		exchangeCode: "exchange-1",
	}
	uc := authUsecase{repo: repo}

	exchangeCode, redirectURL, err := uc.CompleteGoogleAuth(context.Background(), "mock-code", "state-1", " USER@EXAMPLE.COM ", "", " sub-1 ", "")
	if err != nil {
		t.Fatalf("CompleteGoogleAuth failed: %v", err)
	}
	if exchangeCode != "exchange-1" || redirectURL != "https://frontend.example.test/callback" {
		t.Fatalf("unexpected callback result: code=%q redirect=%q", exchangeCode, redirectURL)
	}
	if repo.exchangeExpiresAt.IsZero() {
		t.Fatal("expected exchange code expiration to be set")
	}
}

func TestAuthCompleteGoogleAuthUsesOIDCClaimsAndRejectsNonceMismatch(t *testing.T) {
	repo := &fakeAuthRepo{
		authReq:  ports.AuthRequest{Nonce: "nonce-1", CodeVerifier: "verifier-1"},
		authUser: ports.AuthUserResult{UserID: "user-oidc"},
	}
	oidc := &fakeOIDCProvider{
		configured: true,
		claims: ports.OIDCClaims{
			Iss:   "https://issuer.example.test",
			Sub:   "subject-1",
			Email: "OIDC@EXAMPLE.COM",
			Name:  "OIDC User",
			Nonce: "nonce-1",
		},
	}
	uc := authUsecase{repo: repo, oidc: oidc}

	exchangeCode, _, err := uc.CompleteGoogleAuth(context.Background(), "auth-code", "state-1", "", "", "", "")
	if err != nil {
		t.Fatalf("CompleteGoogleAuth OIDC failed: %v", err)
	}
	if exchangeCode != "exchange-user-oidc" {
		t.Fatalf("unexpected exchange code: %q", exchangeCode)
	}
	if oidc.exchangeCode != "auth-code" || oidc.exchangeVerifier != "verifier-1" {
		t.Fatalf("unexpected OIDC exchange inputs: code=%q verifier=%q", oidc.exchangeCode, oidc.exchangeVerifier)
	}

	oidc.claims.Nonce = "wrong"
	if _, _, err := uc.CompleteGoogleAuth(context.Background(), "auth-code", "state-1", "", "", "", ""); err == nil {
		t.Fatal("expected nonce mismatch to fail")
	}
}

func TestAuthCompleteGoogleAuthRejectsMockParamsInStrictMode(t *testing.T) {
	repo := &fakeAuthRepo{authReq: ports.AuthRequest{Nonce: "nonce-1", CodeVerifier: "verifier-1"}}
	uc := authUsecase{repo: repo, oidc: &fakeOIDCProvider{strict: true, configured: true}}

	if _, _, err := uc.CompleteGoogleAuth(context.Background(), "code", "state", "user@example.com", "", "sub", "issuer"); err == nil {
		t.Fatal("expected strict mode mock callback params to fail")
	}
}

func TestTaskUsecaseDelegatesRepository(t *testing.T) {
	want := model.Task{Id: "task-1", Title: "task"}
	action := model.Toggle
	uc := taskUsecase{repo: fakeTaskRepo{
		task:  want,
		items: []model.Task{want},
		resp:  model.TaskCompletionResponse{TaskId: "task-1"},
	}}

	items, err := uc.ListTasks(context.Background(), "user-1", nil)
	if err != nil || len(items) != 1 || items[0].Id != want.Id {
		t.Fatalf("ListTasks = %+v, %v", items, err)
	}
	created, err := uc.CreateTask(context.Background(), "user-1", model.CreateTaskRequest{Title: "task", Type: model.TaskTypeDaily})
	if err != nil || created.Id != want.Id {
		t.Fatalf("CreateTask = %+v, %v", created, err)
	}
	if _, err := uc.PatchTask(context.Background(), "user-1", "task-1", model.UpdateTaskRequest{}); err != nil {
		t.Fatalf("PatchTask failed: %v", err)
	}
	if err := uc.DeleteTask(context.Background(), "user-1", "task-1"); err != nil {
		t.Fatalf("DeleteTask failed: %v", err)
	}
	if _, err := uc.ReorderTasks(context.Background(), "user-1", model.ReorderTasksRequest{TaskIds: []string{"task-1"}}); err != nil {
		t.Fatalf("ReorderTasks failed: %v", err)
	}
	resp, err := uc.ToggleTaskCompletion(context.Background(), "user-1", "task-1", time.Now(), &action)
	if err != nil || resp.TaskId != "task-1" {
		t.Fatalf("ToggleTaskCompletion = %+v, %v", resp, err)
	}
}

func TestShoppingListUsecaseDelegatesRepositoryAndErrors(t *testing.T) {
	wantErr := errors.New("shopping repo failed")
	uc := shoppingListUsecase{repo: fakeShoppingRepo{
		err:   wantErr,
		item:  model.ShoppingListItem{Id: "item-1", Name: "milk"},
		items: []model.ShoppingListItem{{Id: "item-1", Name: "milk"}},
	}}

	if _, err := uc.ListShoppingItems(context.Background(), "user-1"); !errors.Is(err, wantErr) {
		t.Fatalf("ListShoppingItems error = %v, want %v", err, wantErr)
	}
	if _, err := uc.CreateShoppingItem(context.Background(), "user-1", model.CreateShoppingListItemRequest{Name: "milk"}); !errors.Is(err, wantErr) {
		t.Fatalf("CreateShoppingItem error = %v, want %v", err, wantErr)
	}
	if _, err := uc.PatchShoppingItem(context.Background(), "user-1", "item-1", model.UpdateShoppingListItemRequest{}); !errors.Is(err, wantErr) {
		t.Fatalf("PatchShoppingItem error = %v, want %v", err, wantErr)
	}
	if err := uc.DeleteShoppingItem(context.Background(), "user-1", "item-1"); !errors.Is(err, wantErr) {
		t.Fatalf("DeleteShoppingItem error = %v, want %v", err, wantErr)
	}
	if _, err := uc.ReorderShoppingItems(context.Background(), "user-1", model.ReorderShoppingListItemsRequest{ItemIds: []string{"item-1"}}); !errors.Is(err, wantErr) {
		t.Fatalf("ReorderShoppingItems error = %v, want %v", err, wantErr)
	}
}
