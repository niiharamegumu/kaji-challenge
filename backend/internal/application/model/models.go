package model

import (
	"encoding/json"
	"time"
)

type Date struct {
	time.Time
}

func (d Date) MarshalJSON() ([]byte, error) {
	return json.Marshal(d.Format(time.DateOnly))
}

func (d *Date) UnmarshalJSON(data []byte) error {
	var raw string
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	parsed, err := time.Parse(time.DateOnly, raw)
	if err != nil {
		return err
	}
	d.Time = parsed
	return nil
}

const (
	PushPlatformIOSSafariWebApp PushPlatform = "ios_safari_pwa"
)

const (
	OneTime   ReminderKind = "one_time"
	Recurring ReminderKind = "recurring"
)

const (
	ReminderScheduleTypeDaily   ReminderScheduleType = "daily"
	ReminderScheduleTypeMonthly ReminderScheduleType = "monthly"
	ReminderScheduleTypeWeekly  ReminderScheduleType = "weekly"
)

const (
	TaskTypeDaily  TaskType = "daily"
	TaskTypeWeekly TaskType = "weekly"
)

const (
	TeamMemberRoleMember TeamMemberRole = "member"
	TeamMemberRoleOwner  TeamMemberRole = "owner"
)

const (
	TeamMembershipRoleMember TeamMembershipRole = "member"
	TeamMembershipRoleOwner  TeamMembershipRole = "owner"
)

const (
	Complete  ToggleTaskCompletionRequestAction = "complete"
	Decrement ToggleTaskCompletionRequestAction = "decrement"
	Increment ToggleTaskCompletionRequestAction = "increment"
	Toggle    ToggleTaskCompletionRequestAction = "toggle"
)

type AuthSessionExchangeRequest struct {
	ExchangeCode string `json:"exchangeCode"`
}

type AuthSessionResponse struct {
	User User `json:"user"`
}

type AuthStartResponse struct {
	AuthorizationUrl string `json:"authorizationUrl"`
}

type CloseResponse struct {
	ClosedAt time.Time `json:"closedAt"`
	Month    string    `json:"month"`
}

type MonthCloseCandidate struct {
	Month             string `json:"month"`
	DailyThroughDate  Date   `json:"dailyThroughDate"`
	WeeklyThroughDate Date   `json:"weeklyThroughDate"`
}

type MonthCloseCandidateResponse struct {
	Candidate         *MonthCloseCandidate `json:"candidate"`
	PendingMonthCount int                  `json:"pendingMonthCount"`
}

type CreateInviteRequest struct {
	ExpiresInHours *int `json:"expiresInHours,omitempty"`
}

type CreatePenaltyRuleRequest struct {
	Description *string `json:"description,omitempty"`
	Name        string  `json:"name"`
	Threshold   int     `json:"threshold"`
}

type CreateReminderRequest struct {
	EndDate      *Date                 `json:"endDate,omitempty"`
	Kind         ReminderKind          `json:"kind"`
	Notes        *string               `json:"notes,omitempty"`
	ScheduleType *ReminderScheduleType `json:"scheduleType,omitempty"`
	StartDate    Date                  `json:"startDate"`
	Title        string                `json:"title"`
}

type CreateShoppingListItemRequest struct {
	Name  string  `json:"name"`
	Notes *string `json:"notes,omitempty"`
}

type CreateTaskRequest struct {
	AssigneeUserId             *string  `json:"assigneeUserId,omitempty"`
	Notes                      *string  `json:"notes,omitempty"`
	PenaltyPoints              int      `json:"penaltyPoints"`
	RequiredCompletionsPerWeek *int     `json:"requiredCompletionsPerWeek,omitempty"`
	Title                      string   `json:"title"`
	Type                       TaskType `json:"type"`
}

type InviteCodeResponse struct {
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expiresAt"`
	TeamId    string    `json:"teamId"`
}

type JoinTeamResponse struct {
	TeamId string `json:"teamId"`
}

type ListPushSubscriptionsResponse struct {
	Items          []PushSubscription `json:"items"`
	VapidPublicKey string             `json:"vapidPublicKey"`
}

type MeResponse struct {
	Memberships []TeamMembership `json:"memberships"`
	User        User             `json:"user"`
}

type MonthlyPenaltySummary struct {
	DailyPenaltyTotal       int                      `json:"dailyPenaltyTotal"`
	IsClosed                bool                     `json:"isClosed"`
	Month                   string                   `json:"month"`
	TaskStatusByDate        []MonthlyTaskStatusGroup `json:"taskStatusByDate"`
	TeamId                  string                   `json:"teamId"`
	TotalPenalty            int                      `json:"totalPenalty"`
	TriggeredPenaltyRuleIds []string                 `json:"triggeredPenaltyRuleIds"`
	WeeklyPenaltyTotal      int                      `json:"weeklyPenaltyTotal"`
}

type MonthlyTaskStatusGroup struct {
	Date  Date                    `json:"date"`
	Items []MonthlyTaskStatusItem `json:"items"`
}

type MonthlyTaskStatusItem struct {
	Completed       bool                 `json:"completed"`
	CompletionSlots []TaskCompletionSlot `json:"completionSlots"`
	IsDeleted       bool                 `json:"isDeleted"`
	Notes           *string              `json:"notes,omitempty"`
	PenaltyPoints   int                  `json:"penaltyPoints"`
	TaskId          string               `json:"taskId"`
	Title           string               `json:"title"`
	Type            TaskType             `json:"type"`
}

type PenaltyRule struct {
	CreatedAt   time.Time  `json:"createdAt"`
	DeletedAt   *time.Time `json:"deletedAt"`
	Description *string    `json:"description,omitempty"`
	Id          string     `json:"id"`
	Name        string     `json:"name"`
	TeamId      string     `json:"teamId"`
	Threshold   int        `json:"threshold"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

type PushPlatform string

type PushSubscription struct {
	CreatedAt  time.Time    `json:"createdAt"`
	Endpoint   string       `json:"endpoint"`
	Id         string       `json:"id"`
	IsActive   bool         `json:"isActive"`
	LastSeenAt time.Time    `json:"lastSeenAt"`
	Platform   PushPlatform `json:"platform"`
	TeamId     string       `json:"teamId"`
	UpdatedAt  time.Time    `json:"updatedAt"`
	UserAgent  *string      `json:"userAgent"`
	UserId     string       `json:"userId"`
}

type PushSubscriptionKeys struct {
	Auth   string `json:"auth"`
	P256dh string `json:"p256dh"`
}

type Reminder struct {
	CreatedAt    time.Time             `json:"createdAt"`
	EndDate      *Date                 `json:"endDate"`
	Id           string                `json:"id"`
	Kind         ReminderKind          `json:"kind"`
	Notes        *string               `json:"notes"`
	ScheduleType *ReminderScheduleType `json:"scheduleType,omitempty"`
	StartDate    Date                  `json:"startDate"`
	TeamId       string                `json:"teamId"`
	Title        string                `json:"title"`
	UpdatedAt    time.Time             `json:"updatedAt"`
}

type ReminderCalendarDay struct {
	Date  Date                 `json:"date"`
	Items []ReminderOccurrence `json:"items"`
}

type ReminderCalendarResponse struct {
	Days []ReminderCalendarDay `json:"days"`
}

type ReminderKind string

type ReminderListResponse struct {
	Items []Reminder `json:"items"`
}

type ReminderOccurrence struct {
	Date         Date                  `json:"date"`
	Kind         ReminderKind          `json:"kind"`
	Notes        *string               `json:"notes"`
	ReminderId   string                `json:"reminderId"`
	ScheduleType *ReminderScheduleType `json:"scheduleType,omitempty"`
	Title        string                `json:"title"`
}

type ReminderScheduleType string

type ReorderShoppingListItemsRequest struct {
	ItemIds []string `json:"itemIds"`
}

type ReorderTasksRequest struct {
	TaskIds []string `json:"taskIds"`
}

type ShoppingListItem struct {
	CreatedAt time.Time `json:"createdAt"`
	Id        string    `json:"id"`
	Name      string    `json:"name"`
	Notes     *string   `json:"notes"`
	SortKey   int       `json:"sortKey"`
	TeamId    string    `json:"teamId"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Task struct {
	AssigneeUserId             *string   `json:"assigneeUserId,omitempty"`
	CreatedAt                  time.Time `json:"createdAt"`
	Id                         string    `json:"id"`
	Notes                      *string   `json:"notes,omitempty"`
	PenaltyPoints              int       `json:"penaltyPoints"`
	RequiredCompletionsPerWeek int       `json:"requiredCompletionsPerWeek"`
	SortKey                    int       `json:"sortKey"`
	TeamId                     string    `json:"teamId"`
	Title                      string    `json:"title"`
	Type                       TaskType  `json:"type"`
	UpdatedAt                  time.Time `json:"updatedAt"`
}

type TaskCompletionActor struct {
	ColorHex      *string `json:"colorHex"`
	EffectiveName string  `json:"effectiveName"`
	UserId        string  `json:"userId"`
}

type TaskCompletionResponse struct {
	Completed            bool   `json:"completed"`
	TargetDate           Date   `json:"targetDate"`
	TaskId               string `json:"taskId"`
	WeeklyCompletedCount int    `json:"weeklyCompletedCount"`
}

type TaskCompletionSlot struct {
	Actor *TaskCompletionActor `json:"actor,omitempty"`
	Slot  int                  `json:"slot"`
}

type TaskOverviewDailyTask struct {
	CompletedBy    *TaskCompletionActor `json:"completedBy,omitempty"`
	CompletedToday bool                 `json:"completedToday"`
	Task           Task                 `json:"task"`
}

type TaskOverviewResponse struct {
	DailyTasks          []TaskOverviewDailyTask  `json:"dailyTasks"`
	ElapsedDaysInWeek   int                      `json:"elapsedDaysInWeek"`
	Month               string                   `json:"month"`
	MonthlyPenaltyTotal int                      `json:"monthlyPenaltyTotal"`
	Today               Date                     `json:"today"`
	WeeklyReminders     []ReminderOccurrence     `json:"weeklyReminders"`
	WeeklyTasks         []TaskOverviewWeeklyTask `json:"weeklyTasks"`
}

type TaskOverviewWeeklyTask struct {
	CompletionSlots            []TaskCompletionSlot `json:"completionSlots"`
	RequiredCompletionsPerWeek int                  `json:"requiredCompletionsPerWeek"`
	Task                       Task                 `json:"task"`
	WeekCompletedCount         int                  `json:"weekCompletedCount"`
}

type TaskType string

type TeamInfoResponse struct {
	Name   string `json:"name"`
	TeamId string `json:"teamId"`
}

type TeamMember struct {
	ColorHex      *string        `json:"colorHex"`
	DisplayName   string         `json:"displayName"`
	EffectiveName string         `json:"effectiveName"`
	JoinedAt      time.Time      `json:"joinedAt"`
	Nickname      *string        `json:"nickname"`
	Role          TeamMemberRole `json:"role"`
	UserId        string         `json:"userId"`
}

type TeamMemberRole string

type TeamMembersResponse struct {
	Items []TeamMember `json:"items"`
}

type TeamMembership struct {
	Role     TeamMembershipRole `json:"role"`
	TeamId   string             `json:"teamId"`
	TeamName string             `json:"teamName"`
}

type TeamMembershipRole string

type ToggleTaskCompletionRequest struct {
	Action     *ToggleTaskCompletionRequestAction `json:"action,omitempty"`
	TargetDate Date                               `json:"targetDate"`
}

type ToggleTaskCompletionRequestAction string

type UpdateColorRequest struct {
	ColorHex *string `json:"colorHex"`
}

type UpdateColorResponse struct {
	ColorHex *string `json:"colorHex"`
}

type UpdateCurrentTeamRequest struct {
	Name string `json:"name"`
}

type UpdateNicknameRequest struct {
	Nickname string `json:"nickname"`
}

type UpdateNicknameResponse struct {
	EffectiveName string `json:"effectiveName"`
	Nickname      string `json:"nickname"`
}

type UpdatePenaltyRuleRequest struct {
	Description *string `json:"description,omitempty"`
	Name        *string `json:"name,omitempty"`
	Threshold   *int    `json:"threshold,omitempty"`
}

type UpdateReminderRequest struct {
	EndDate      *Date                 `json:"endDate"`
	Kind         *ReminderKind         `json:"kind,omitempty"`
	Notes        *string               `json:"notes"`
	ScheduleType *ReminderScheduleType `json:"scheduleType,omitempty"`
	StartDate    *Date                 `json:"startDate,omitempty"`
	Title        *string               `json:"title,omitempty"`
}

type UpdateShoppingListItemRequest struct {
	Name  *string `json:"name,omitempty"`
	Notes *string `json:"notes"`
}

type UpdateTaskRequest struct {
	AssigneeUserId             *string `json:"assigneeUserId,omitempty"`
	Notes                      *string `json:"notes,omitempty"`
	PenaltyPoints              *int    `json:"penaltyPoints,omitempty"`
	RequiredCompletionsPerWeek *int    `json:"requiredCompletionsPerWeek,omitempty"`
	Title                      *string `json:"title,omitempty"`
}

type UpsertPushSubscriptionRequest struct {
	Endpoint  string               `json:"endpoint"`
	Keys      PushSubscriptionKeys `json:"keys"`
	Platform  PushPlatform         `json:"platform"`
	UserAgent *string              `json:"userAgent,omitempty"`
}

type User struct {
	ColorHex    *string   `json:"colorHex"`
	CreatedAt   time.Time `json:"createdAt"`
	DisplayName string    `json:"displayName"`
	Email       string    `json:"email"`
	Id          string    `json:"id"`
}
