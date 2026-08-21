package ports

import (
	"context"
	"time"

	model "github.com/megu/kaji-challenge/backend/internal/application/model"
)

type AuthRepository interface {
	CreateAuthRequest(ctx context.Context, state, nonce, codeVerifier string, expiresAt time.Time) error
	ConsumeAuthRequest(ctx context.Context, state string, now time.Time) (AuthRequest, error)
	GetOrCreateAuthUser(ctx context.Context, issuer, subject, email, name string) (AuthUserResult, error)
	CreateExchangeCode(ctx context.Context, userID string, expiresAt time.Time) (string, error)
	ExchangeSession(ctx context.Context, exchangeCode string) (AuthSession, error)
	RevokeSession(ctx context.Context, token string)
	LookupSession(ctx context.Context, token string) (string, bool)
}

type TeamRepository interface {
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

type PushRepository interface {
	UpsertPushSubscription(ctx context.Context, userID string, req model.UpsertPushSubscriptionRequest) (model.PushSubscription, error)
	DeletePushSubscription(ctx context.Context, userID, subscriptionID string) error
	ListPushSubscriptions(ctx context.Context, userID string) (model.ListPushSubscriptionsResponse, error)
	ListPushTeamIDs(ctx context.Context) ([]string, error)
	ListPendingPushTasks(ctx context.Context, teamID string, taskType model.TaskType, now, slotDate time.Time) ([]PendingPushTask, error)
	ListActivePushSubscriptions(ctx context.Context, teamID string) ([]PushSubscriptionTarget, error)
	DeactivatePushSubscriptionByEndpoint(ctx context.Context, endpoint string, updatedAt time.Time) error
	Now() time.Time
}

type TaskRepository interface {
	ListTasks(ctx context.Context, userID string, filter *model.TaskType) ([]model.Task, error)
	CreateTask(ctx context.Context, userID string, req model.CreateTaskRequest) (model.Task, error)
	PatchTask(ctx context.Context, userID, taskID string, req model.UpdateTaskRequest) (model.Task, error)
	DeleteTask(ctx context.Context, userID, taskID string) error
	ReorderTasks(ctx context.Context, userID string, req model.ReorderTasksRequest) ([]model.Task, error)
	ToggleTaskCompletion(ctx context.Context, userID, taskID string, target time.Time, action *model.ToggleTaskCompletionRequestAction) (model.TaskCompletionResponse, error)
}

type PenaltyRepository interface {
	ListPenaltyRules(ctx context.Context, userID string, includeDeleted bool) ([]model.PenaltyRule, error)
	CreatePenaltyRule(ctx context.Context, userID string, req model.CreatePenaltyRuleRequest) (model.PenaltyRule, error)
	PatchPenaltyRule(ctx context.Context, userID, ruleID string, req model.UpdatePenaltyRuleRequest) (model.PenaltyRule, error)
	DeletePenaltyRule(ctx context.Context, userID, ruleID string) error
}

type ShoppingListRepository interface {
	ListShoppingItems(ctx context.Context, userID string) ([]model.ShoppingListItem, error)
	CreateShoppingItem(ctx context.Context, userID string, req model.CreateShoppingListItemRequest) (model.ShoppingListItem, error)
	PatchShoppingItem(ctx context.Context, userID, itemID string, req model.UpdateShoppingListItemRequest) (model.ShoppingListItem, error)
	DeleteShoppingItem(ctx context.Context, userID, itemID string) error
	ReorderShoppingItems(ctx context.Context, userID string, req model.ReorderShoppingListItemsRequest) ([]model.ShoppingListItem, error)
}

type ReminderRepository interface {
	ListReminders(ctx context.Context, userID string, from, to time.Time) ([]model.ReminderCalendarDay, error)
	ListReminderDefinitions(ctx context.Context, userID string) ([]model.Reminder, error)
	CreateReminder(ctx context.Context, userID string, req model.CreateReminderRequest) (model.Reminder, error)
	PatchReminder(ctx context.Context, userID, reminderID string, req model.UpdateReminderRequest) (model.Reminder, error)
	DeleteReminder(ctx context.Context, userID, reminderID string) error
}

type TaskOverviewRepository interface {
	PrimaryTeamID(ctx context.Context, userID string) (string, error)
	Now() time.Time
	EnsureMonthSummary(ctx context.Context, teamID, month string) (MonthlyPenaltySummarySnapshot, error)
	CleanupExpiredOneTimeReminders(ctx context.Context, teamID string) error
	ListOverviewTasks(ctx context.Context, teamID string) ([]OverviewTask, error)
	ListDailyCompletionActors(ctx context.Context, teamID string, targetDate time.Time) ([]DailyCompletionActor, error)
	ListWeeklyCompletionCounts(ctx context.Context, teamID string, weekStart time.Time) ([]WeeklyCompletionCount, error)
	ListWeeklyCompletionSlots(ctx context.Context, teamID string, weekStart time.Time) ([]WeeklyCompletionSlot, error)
	ListReminderRecords(ctx context.Context, teamID string) ([]ReminderRecord, error)
	ListTriggeredRuleIDs(ctx context.Context, teamID string, monthStart time.Time) ([]string, error)
	ListEffectivePenaltyRules(ctx context.Context, teamID string, asOf time.Time) ([]PenaltyRuleSnapshot, error)
	ListMonthlyStatusTasks(ctx context.Context, teamID string, monthStart, monthEnd time.Time) ([]MonthlyTaskStatusRecord, error)
	ListDailyCompletionsByMonth(ctx context.Context, teamID string, monthStart, monthEnd time.Time) ([]DailyCompletionByDate, error)
	ListWeeklyCompletionCountsByMonth(ctx context.Context, teamID string, weekStart, monthEnd time.Time) ([]WeeklyCompletionCountByWeek, error)
	ListWeeklyCompletionSlotsByMonth(ctx context.Context, teamID string, weekStart, monthEnd time.Time) ([]WeeklyCompletionSlotByWeek, error)
}

type AdminRepository interface {
	ListClosableTeamIDs(ctx context.Context) ([]string, error)
	PrimaryTeamID(ctx context.Context, userID string) (string, error)
	RunTeamRevisionCAS(ctx context.Context, teamID, entity string, hints map[string]string, fn func(context.Context) error) error
	GetMonthCloseCandidate(ctx context.Context, teamID string) (model.MonthCloseCandidateResponse, error)
	IsMonthClosed(ctx context.Context, teamID, month string) (bool, error)
	FinalizeMonth(ctx context.Context, teamID, month string) error
	NextDayCloseTarget(ctx context.Context, teamID string) (time.Time, bool, error)
	NextWeekCloseTarget(ctx context.Context, teamID string) (time.Time, bool, error)
	CloseDayTarget(ctx context.Context, teamID string, targetDate time.Time) (bool, error)
	CloseWeekTarget(ctx context.Context, teamID string, weekStart time.Time) (bool, error)
	Now() time.Time
}

type Dependencies struct {
	AuthRepo         AuthRepository
	TeamRepo         TeamRepository
	PushRepo         PushRepository
	TaskRepo         TaskRepository
	PenaltyRepo      PenaltyRepository
	ShoppingListRepo ShoppingListRepository
	ReminderRepo     ReminderRepository
	TaskOverviewRepo TaskOverviewRepository
	AdminRepo        AdminRepository
	OIDCProvider     OIDCProvider
}

type AuthRequest struct {
	Nonce        string
	CodeVerifier string
	ExpiresAt    time.Time
}

type AuthUserResult struct {
	UserID string
	User   model.User
}

type OIDCClaims struct {
	Iss   string
	Sub   string
	Email string
	Name  string
	Nonce string
}

type OIDCProvider interface {
	Configured() bool
	StrictMode() bool
	ValidateSettings() error
	MockAuthorizationURL(state string) string
	AuthorizationURL(ctx context.Context, state, nonce, verifier string) (string, error)
	ExchangeAndVerify(ctx context.Context, code, verifier string) (OIDCClaims, error)
}

type NotifyRunResult struct {
	Processed int
	Sent      int
	Skipped   int
	Failed    int
}

type PendingPushTask struct {
	ID        string
	Title     string
	Remaining int
}

type PushSubscriptionTarget struct {
	Endpoint string
	P256DH   string
	Auth     string
}

type PushSubscriptionEndpoint struct {
	Endpoint string
	P256DH   string
	Auth     string
}

type PushPayload struct {
	Title    string
	Body     string
	Tag      string
	URL      string
	TeamID   string
	SlotKind string
}

type PushResult struct {
	StatusCode int
	Expired    bool
	Body       string
	APNSID     string
	Location   string
	RetryAfter string
}

type PushSender interface {
	Send(ctx context.Context, sub PushSubscriptionEndpoint, payload PushPayload) (PushResult, error)
}

type MonthlyPenaltySummarySnapshot struct {
	TeamID             string
	MonthStart         time.Time
	DailyPenaltyTotal  int
	WeeklyPenaltyTotal int
	IsClosed           bool
}

type OverviewTask struct {
	ID                         string
	TeamID                     string
	Title                      string
	Notes                      *string
	Type                       model.TaskType
	PenaltyPoints              int
	AssigneeUserID             *string
	RequiredCompletionsPerWeek int
	SortKey                    int
	CreatedAt                  time.Time
	UpdatedAt                  time.Time
	DeletedAt                  *time.Time
}

type TaskCompletionActor struct {
	UserID        string
	EffectiveName string
	ColorHex      *string
}

type DailyCompletionActor struct {
	TaskID string
	Actor  *TaskCompletionActor
}

type WeeklyCompletionCount struct {
	TaskID          string
	CompletionCount int
}

type WeeklyCompletionSlot struct {
	TaskID string
	Slot   int
	Actor  *TaskCompletionActor
}

type ReminderRecord struct {
	ID           string
	TeamID       string
	Title        string
	Notes        *string
	Kind         model.ReminderKind
	ScheduleType *model.ReminderScheduleType
	StartDate    time.Time
	EndDate      *time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type PenaltyRuleSnapshot struct {
	ID        string
	Threshold int
}

type MonthlyTaskStatusRecord = OverviewTask

type DailyCompletionByDate struct {
	Date   time.Time
	TaskID string
	Actor  *TaskCompletionActor
}

type WeeklyCompletionCountByWeek struct {
	WeekStart       time.Time
	TaskID          string
	CompletionCount int
}

type WeeklyCompletionSlotByWeek struct {
	WeekStart time.Time
	TaskID    string
	Slot      int
	Actor     *TaskCompletionActor
}
