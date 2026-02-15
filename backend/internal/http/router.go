package http

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	"github.com/megu/kaji-challenge/backend/internal/http/middleware"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

const (
	authUserIDKey = "auth.userId"
	authTokenKey  = "auth.token"
	jstTZ         = "Asia/Tokyo"
)

func NewRouter() *gin.Engine {
	return NewRouterWithStore(newStore())
}

func NewRouterWithStore(s *store) *gin.Engine {
	r := gin.Default()
	r.Use(middleware.CORS())
	r.Use(authMiddleware(s))
	api.RegisterHandlers(r, &Handler{store: s})
	return r
}

type store struct {
	mu sync.Mutex

	loc *time.Location
	db  *pgxpool.Pool
	q   *dbsqlc.Queries

	users       map[string]userRecord
	usersByMail map[string]string
	memberships map[string][]membership
	sessions    map[string]string

	invites map[string]inviteCode
	tasks   map[string]taskRecord
	rules   map[string]ruleRecord

	completions map[string]bool

	monthSummaries map[string]*monthSummary
	dayPenaltyKeys map[string]bool
	weekPenaltyKey map[string]bool
	monthClosedKey map[string]bool

	authRequests  map[string]authRequest
	exchangeCodes map[string]exchangeCodeRecord

	oidc *oidcClient
}

type userRecord struct {
	ID        string
	Email     string
	Name      string
	CreatedAt time.Time
}

type membership struct {
	TeamID string
	Role   api.TeamMembershipRole
}

type inviteCode struct {
	Code      string
	TeamID    string
	ExpiresAt time.Time
	MaxUses   int
	UsedCount int
}

type taskRecord struct {
	ID         string
	TeamID     string
	Title      string
	Notes      *string
	Type       api.TaskType
	Penalty    int
	AssigneeID *string
	IsActive   bool
	Required   int
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type ruleRecord struct {
	ID          string
	TeamID      string
	Threshold   int
	Name        string
	Description *string
	IsActive    bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type monthSummary struct {
	TeamID          string
	Month           string
	DailyPenalty    int
	WeeklyPenalty   int
	IsClosed        bool
	TriggeredRuleID []string
}

func newStore() *store {
	loc, _ := time.LoadLocation(jstTZ)
	if loc == nil {
		loc = time.FixedZone("JST", 9*60*60)
	}

	s := &store{
		loc:            loc,
		users:          map[string]userRecord{},
		usersByMail:    map[string]string{},
		memberships:    map[string][]membership{},
		sessions:       map[string]string{},
		invites:        map[string]inviteCode{},
		tasks:          map[string]taskRecord{},
		rules:          map[string]ruleRecord{},
		completions:    map[string]bool{},
		monthSummaries: map[string]*monthSummary{},
		dayPenaltyKeys: map[string]bool{},
		weekPenaltyKey: map[string]bool{},
		monthClosedKey: map[string]bool{},
		authRequests:   map[string]authRequest{},
		exchangeCodes:  map[string]exchangeCodeRecord{},
	}
	if err := validateOIDCSettings(); err != nil {
		panic(err)
	}
	if err := s.initPersistence(); err != nil {
		panic(err)
	}
	return s
}

func (s *store) initPersistence() error {
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	db, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return err
	}
	if err := db.Ping(ctx); err != nil {
		return err
	}
	s.db = db
	s.q = dbsqlc.New(db)
	return nil
}

func authMiddleware(s *store) gin.HandlerFunc {
	publicPaths := map[string]bool{
		"/health":                    true,
		"/v1/auth/google/start":      true,
		"/v1/auth/google/callback":   true,
		"/v1/auth/sessions/exchange": true,
	}

	return func(c *gin.Context) {
		if c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}
		if publicPaths[c.Request.URL.Path] {
			c.Next()
			return
		}

		auth := c.GetHeader("Authorization")
		token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer"))
		if token == "" {
			writeError(c, http.StatusUnauthorized, "missing bearer token")
			c.Abort()
			return
		}

		userID, ok := s.lookupSession(c.Request.Context(), token)
		if !ok {
			writeError(c, http.StatusUnauthorized, "invalid bearer token")
			c.Abort()
			return
		}
		c.Set(authUserIDKey, userID)
		c.Set(authTokenKey, token)
		c.Next()
	}
}

func (s *store) getOrCreateUserLocked(ctx context.Context, email, displayName string) (string, userRecord, error) {
	now := time.Now().In(s.loc)
	row, err := s.q.GetUserByEmail(ctx, email)
	if err == nil {
		if displayName != "" && row.DisplayName != displayName {
			if err := s.q.UpdateUserDisplayName(ctx, dbsqlc.UpdateUserDisplayNameParams{
				ID:          row.ID,
				DisplayName: displayName,
			}); err != nil {
				return "", userRecord{}, err
			}
			row.DisplayName = displayName
		}
		return row.ID, userRecord{ID: row.ID, Email: row.Email, Name: row.DisplayName, CreatedAt: row.CreatedAt.Time.In(s.loc)}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", userRecord{}, err
	}
	userID := s.nextID("usr")
	teamID := s.nextID("team")
	user := userRecord{ID: userID, Email: email, Name: displayName, CreatedAt: now}
	if err := s.q.CreateUser(ctx, dbsqlc.CreateUserParams{
		ID:          user.ID,
		Email:       user.Email,
		DisplayName: user.Name,
		CreatedAt:   toPgTimestamptz(user.CreatedAt),
	}); err != nil {
		return "", userRecord{}, err
	}
	if err := s.q.CreateTeam(ctx, dbsqlc.CreateTeamParams{
		ID:        teamID,
		CreatedAt: toPgTimestamptz(now),
	}); err != nil {
		return "", userRecord{}, err
	}
	if err := s.q.AddTeamMember(ctx, dbsqlc.AddTeamMemberParams{
		TeamID:    teamID,
		UserID:    user.ID,
		Role:      string(api.Owner),
		CreatedAt: toPgTimestamptz(now),
	}); err != nil {
		return "", userRecord{}, err
	}
	return user.ID, user, nil
}

func (s *store) currentUserAndMemberships(ctx context.Context, userID string) (userRecord, []api.TeamMembership, error) {
	row, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return userRecord{}, nil, errors.New("user not found")
	}
	mRows, err := s.q.ListMembershipsByUserID(ctx, userID)
	if err != nil {
		return userRecord{}, nil, err
	}
	memberships := make([]api.TeamMembership, 0, len(mRows))
	for _, m := range mRows {
		role := api.Member
		if m.Role == string(api.Owner) {
			role = api.Owner
		}
		memberships = append(memberships, api.TeamMembership{TeamId: m.TeamID, Role: role})
	}
	return userRecord{
		ID:        row.ID,
		Email:     row.Email,
		Name:      row.DisplayName,
		CreatedAt: row.CreatedAt.Time.In(s.loc),
	}, memberships, nil
}

func (s *store) createInvite(ctx context.Context, userID string, req api.CreateInviteRequest) (api.InviteCodeResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.InviteCodeResponse{}, err
	}

	maxUses := 1
	if req.MaxUses != nil {
		maxUses = *req.MaxUses
	}
	expiresInHours := 72
	if req.ExpiresInHours != nil {
		expiresInHours = *req.ExpiresInHours
	}
	maxUses32, err := safeInt32(maxUses, "max uses")
	if err != nil {
		return api.InviteCodeResponse{}, err
	}

	raw, err := randomToken()
	if err != nil {
		return api.InviteCodeResponse{}, err
	}
	code := strings.ToUpper(raw[:10])
	expiresAt := time.Now().In(s.loc).Add(time.Duration(expiresInHours) * time.Hour)
	if err := s.q.CreateInviteCode(ctx, dbsqlc.CreateInviteCodeParams{
		Code:      code,
		TeamID:    teamID,
		ExpiresAt: toPgTimestamptz(expiresAt),
		MaxUses:   maxUses32,
		UsedCount: 0,
	}); err != nil {
		return api.InviteCodeResponse{}, err
	}

	return api.InviteCodeResponse{
		Code:      code,
		TeamId:    teamID,
		ExpiresAt: expiresAt,
		MaxUses:   maxUses,
		UsedCount: 0,
	}, nil
}

func (s *store) joinTeam(ctx context.Context, userID, code string) (api.JoinTeamResponse, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	invite, err := s.q.GetInviteCode(ctx, code)
	if err != nil {
		return api.JoinTeamResponse{}, errors.New("invite code not found")
	}
	now := time.Now().In(s.loc)
	if invite.ExpiresAt.Time.In(s.loc).Before(now) {
		return api.JoinTeamResponse{}, errors.New("invite code expired")
	}
	if invite.UsedCount >= invite.MaxUses {
		return api.JoinTeamResponse{}, errors.New("invite code max uses exceeded")
	}

	memberships, err := s.q.ListMembershipsByUserID(ctx, userID)
	if err != nil {
		return api.JoinTeamResponse{}, err
	}
	for _, m := range memberships {
		if m.TeamID == invite.TeamID {
			return api.JoinTeamResponse{TeamId: invite.TeamID}, nil
		}
	}

	if err := s.q.AddTeamMember(ctx, dbsqlc.AddTeamMemberParams{
		TeamID:    invite.TeamID,
		UserID:    userID,
		Role:      string(api.Member),
		CreatedAt: toPgTimestamptz(now),
	}); err != nil {
		return api.JoinTeamResponse{}, err
	}
	rows, err := s.q.IncrementInviteCodeUsedCount(ctx, code)
	if err != nil {
		return api.JoinTeamResponse{}, err
	}
	if rows == 0 {
		return api.JoinTeamResponse{}, errors.New("invite code max uses exceeded")
	}
	return api.JoinTeamResponse{TeamId: invite.TeamID}, nil
}

func (s *store) listTasks(ctx context.Context, userID string, filter *api.TaskType) ([]api.Task, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListTasksByTeamID(ctx, teamID)
	if err != nil {
		return nil, err
	}
	items := []api.Task{}
	for _, row := range rows {
		t := taskFromListRow(row, s.loc)
		if filter != nil && t.Type != *filter {
			continue
		}
		items = append(items, t.toAPI())
	}
	return items, nil
}

func (s *store) createTask(ctx context.Context, userID string, req api.CreateTaskRequest) (api.Task, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.Task{}, err
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		return api.Task{}, errors.New("title is required")
	}

	required := 1
	if req.Type == api.Weekly && req.RequiredCompletionsPerWeek != nil {
		required = *req.RequiredCompletionsPerWeek
	}
	if req.Type == api.Daily {
		required = 1
	}
	penalty32, err := safeInt32(req.PenaltyPoints, "penalty points")
	if err != nil {
		return api.Task{}, err
	}
	required32, err := safeInt32(required, "required completions")
	if err != nil {
		return api.Task{}, err
	}

	active := true
	if req.IsActive != nil {
		active = *req.IsActive
	}
	now := time.Now().In(s.loc)
	taskID := s.nextID("tsk")
	task := taskRecord{
		ID:         taskID,
		TeamID:     teamID,
		Title:      title,
		Notes:      req.Notes,
		Type:       req.Type,
		Penalty:    req.PenaltyPoints,
		AssigneeID: req.AssigneeUserId,
		IsActive:   active,
		Required:   required,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if err := s.q.CreateTask(ctx, dbsqlc.CreateTaskParams{
		ID:                         task.ID,
		TeamID:                     task.TeamID,
		Title:                      task.Title,
		Notes:                      textFromPtr(task.Notes),
		Type:                       string(task.Type),
		PenaltyPoints:              penalty32,
		Column7:                    uuidStringFromPtr(task.AssigneeID),
		IsActive:                   task.IsActive,
		RequiredCompletionsPerWeek: required32,
		CreatedAt:                  toPgTimestamptz(task.CreatedAt),
		UpdatedAt:                  toPgTimestamptz(task.UpdatedAt),
	}); err != nil {
		return api.Task{}, err
	}
	return task.toAPI(), nil
}

func (s *store) patchTask(ctx context.Context, userID, taskID string, req api.UpdateTaskRequest) (api.Task, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.Task{}, err
	}
	row, err := s.q.GetTaskByID(ctx, taskID)
	if err != nil {
		return api.Task{}, errors.New("task not found")
	}
	task := taskFromGetRow(row, s.loc)
	if task.TeamID != teamID {
		return api.Task{}, errors.New("task not found")
	}
	if req.Title != nil {
		title := strings.TrimSpace(*req.Title)
		if title == "" {
			return api.Task{}, errors.New("title cannot be empty")
		}
		task.Title = title
	}
	if req.Notes != nil {
		task.Notes = req.Notes
	}
	if req.PenaltyPoints != nil {
		task.Penalty = *req.PenaltyPoints
	}
	if req.AssigneeUserId != nil {
		task.AssigneeID = req.AssigneeUserId
	}
	if req.IsActive != nil {
		task.IsActive = *req.IsActive
	}
	if req.RequiredCompletionsPerWeek != nil && task.Type == api.Weekly {
		task.Required = *req.RequiredCompletionsPerWeek
	}
	task.UpdatedAt = time.Now().In(s.loc)
	penalty32, err := safeInt32(task.Penalty, "penalty points")
	if err != nil {
		return api.Task{}, err
	}
	required32, err := safeInt32(task.Required, "required completions")
	if err != nil {
		return api.Task{}, err
	}
	if err := s.q.UpdateTask(ctx, dbsqlc.UpdateTaskParams{
		ID:                         task.ID,
		Title:                      task.Title,
		Notes:                      textFromPtr(task.Notes),
		PenaltyPoints:              penalty32,
		Column5:                    uuidStringFromPtr(task.AssigneeID),
		IsActive:                   task.IsActive,
		RequiredCompletionsPerWeek: required32,
		UpdatedAt:                  toPgTimestamptz(task.UpdatedAt),
	}); err != nil {
		return api.Task{}, err
	}
	return task.toAPI(), nil
}

func (s *store) deleteTask(ctx context.Context, userID, taskID string) error {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return err
	}
	task, err := s.q.GetTaskByID(ctx, taskID)
	if err != nil || task.TeamID != teamID {
		return errors.New("task not found")
	}
	if err := s.q.DeleteTaskCompletionsByTaskID(ctx, taskID); err != nil {
		return err
	}
	return s.q.DeleteTask(ctx, taskID)
}

func (s *store) toggleTaskCompletion(ctx context.Context, userID, taskID string, target time.Time) (api.TaskCompletionResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.TaskCompletionResponse{}, err
	}
	row, err := s.q.GetTaskByID(ctx, taskID)
	if err != nil {
		return api.TaskCompletionResponse{}, errors.New("task not found")
	}
	task := taskFromGetRow(row, s.loc)
	if task.TeamID != teamID {
		return api.TaskCompletionResponse{}, errors.New("task not found")
	}
	if !task.IsActive {
		return api.TaskCompletionResponse{}, errors.New("task is inactive")
	}

	today := dateOnly(time.Now().In(s.loc), s.loc)
	targetDate := dateOnly(target.In(s.loc), s.loc)
	if task.Type == api.Daily && !sameDate(targetDate, today) {
		return api.TaskCompletionResponse{}, errors.New("daily completion can only be toggled for today")
	}
	if task.Type == api.Weekly {
		weekStart := startOfWeek(today, s.loc)
		weekEnd := weekStart.AddDate(0, 0, 6)
		if targetDate.Before(weekStart) || targetDate.After(weekEnd) {
			return api.TaskCompletionResponse{}, errors.New("weekly completion can only be toggled within current week")
		}
	}

	targetPg := toPgDate(targetDate)
	exists, err := s.q.HasTaskCompletion(ctx, dbsqlc.HasTaskCompletionParams{
		TaskID:     taskID,
		TargetDate: targetPg,
	})
	if err != nil {
		return api.TaskCompletionResponse{}, err
	}
	completed := !exists
	if completed {
		if err := s.q.CreateTaskCompletion(ctx, dbsqlc.CreateTaskCompletionParams{
			TaskID:     taskID,
			TargetDate: targetPg,
		}); err != nil {
			return api.TaskCompletionResponse{}, err
		}
	} else {
		if err := s.q.DeleteTaskCompletion(ctx, dbsqlc.DeleteTaskCompletionParams{
			TaskID:     taskID,
			TargetDate: targetPg,
		}); err != nil {
			return api.TaskCompletionResponse{}, err
		}
	}

	count, err := s.weeklyCompletionCountLocked(ctx, taskID, startOfWeek(targetDate, s.loc))
	if err != nil {
		return api.TaskCompletionResponse{}, err
	}
	return api.TaskCompletionResponse{
		TaskId:               taskID,
		TargetDate:           toDate(targetDate),
		Completed:            completed,
		WeeklyCompletedCount: count,
	}, nil
}

func (s *store) listPenaltyRules(ctx context.Context, userID string) ([]api.PenaltyRule, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListPenaltyRulesByTeamID(ctx, teamID)
	if err != nil {
		return nil, err
	}
	items := []api.PenaltyRule{}
	for _, row := range rows {
		items = append(items, ruleFromDB(row, s.loc).toAPI())
	}
	return items, nil
}

func (s *store) createPenaltyRule(ctx context.Context, userID string, req api.CreatePenaltyRuleRequest) (api.PenaltyRule, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.PenaltyRule{}, err
	}
	now := time.Now().In(s.loc)
	active := true
	if req.IsActive != nil {
		active = *req.IsActive
	}
	r := ruleRecord{
		ID:          s.nextID("pr"),
		TeamID:      teamID,
		Threshold:   req.Threshold,
		Name:        req.Name,
		Description: req.Description,
		IsActive:    active,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	threshold32, err := safeInt32(r.Threshold, "threshold")
	if err != nil {
		return api.PenaltyRule{}, err
	}
	if err := s.q.CreatePenaltyRule(ctx, dbsqlc.CreatePenaltyRuleParams{
		ID:          r.ID,
		TeamID:      r.TeamID,
		Threshold:   threshold32,
		Name:        r.Name,
		Description: textFromPtr(r.Description),
		IsActive:    r.IsActive,
		CreatedAt:   toPgTimestamptz(r.CreatedAt),
		UpdatedAt:   toPgTimestamptz(r.UpdatedAt),
	}); err != nil {
		return api.PenaltyRule{}, err
	}
	return r.toAPI(), nil
}

func (s *store) patchPenaltyRule(ctx context.Context, userID, ruleID string, req api.UpdatePenaltyRuleRequest) (api.PenaltyRule, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.PenaltyRule{}, err
	}
	row, err := s.q.GetPenaltyRuleByID(ctx, ruleID)
	if err != nil {
		return api.PenaltyRule{}, errors.New("rule not found")
	}
	rule := ruleFromDB(row, s.loc)
	if rule.TeamID != teamID {
		return api.PenaltyRule{}, errors.New("rule not found")
	}
	if req.Threshold != nil {
		rule.Threshold = *req.Threshold
	}
	if req.Name != nil {
		rule.Name = strings.TrimSpace(*req.Name)
	}
	if req.Description != nil {
		rule.Description = req.Description
	}
	if req.IsActive != nil {
		rule.IsActive = *req.IsActive
	}
	rule.UpdatedAt = time.Now().In(s.loc)
	threshold32, err := safeInt32(rule.Threshold, "threshold")
	if err != nil {
		return api.PenaltyRule{}, err
	}
	if err := s.q.UpdatePenaltyRule(ctx, dbsqlc.UpdatePenaltyRuleParams{
		ID:          rule.ID,
		Threshold:   threshold32,
		Name:        rule.Name,
		Description: textFromPtr(rule.Description),
		IsActive:    rule.IsActive,
		UpdatedAt:   toPgTimestamptz(rule.UpdatedAt),
	}); err != nil {
		return api.PenaltyRule{}, err
	}
	return rule.toAPI(), nil
}

func (s *store) deletePenaltyRule(ctx context.Context, userID, ruleID string) error {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return err
	}
	rule, err := s.q.GetPenaltyRuleByID(ctx, ruleID)
	if err != nil || rule.TeamID != teamID {
		return errors.New("rule not found")
	}
	return s.q.DeletePenaltyRule(ctx, ruleID)
}

func (s *store) getHome(ctx context.Context, userID string) (api.HomeResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.HomeResponse{}, err
	}

	now := time.Now().In(s.loc)
	if err := s.autoCloseLocked(ctx, now, teamID); err != nil {
		return api.HomeResponse{}, err
	}

	today := dateOnly(now, s.loc)
	weekStart := startOfWeek(today, s.loc)
	monthKey := today.Format("2006-01")
	monthly, err := s.ensureMonthSummaryLocked(ctx, teamID, monthKey)
	if err != nil {
		return api.HomeResponse{}, err
	}
	daily := []api.HomeDailyTask{}
	weekly := []api.HomeWeeklyTask{}

	tasks, err := s.q.ListActiveTasksByTeamID(ctx, teamID)
	if err != nil {
		return api.HomeResponse{}, err
	}
	for _, row := range tasks {
		t := taskFromActiveListRow(row, s.loc)
		if t.Type == api.Daily {
			done, err := s.q.HasTaskCompletion(ctx, dbsqlc.HasTaskCompletionParams{
				TaskID:     t.ID,
				TargetDate: toPgDate(today),
			})
			if err != nil {
				return api.HomeResponse{}, err
			}
			daily = append(daily, api.HomeDailyTask{
				Task:           t.toAPI(),
				CompletedToday: done,
			})
			continue
		}
		count, err := s.weeklyCompletionCountLocked(ctx, t.ID, weekStart)
		if err != nil {
			return api.HomeResponse{}, err
		}
		weekly = append(weekly, api.HomeWeeklyTask{
			Task:                       t.toAPI(),
			WeekCompletedCount:         count,
			RequiredCompletionsPerWeek: t.Required,
		})
	}

	sort.Slice(daily, func(i, j int) bool { return daily[i].Task.CreatedAt.Before(daily[j].Task.CreatedAt) })
	sort.Slice(weekly, func(i, j int) bool { return weekly[i].Task.CreatedAt.Before(weekly[j].Task.CreatedAt) })

	elapsed := int(today.Sub(weekStart).Hours()/24) + 1
	return api.HomeResponse{
		Month:               monthKey,
		Today:               toDate(today),
		ElapsedDaysInWeek:   elapsed,
		MonthlyPenaltyTotal: int(monthly.DailyPenaltyTotal + monthly.WeeklyPenaltyTotal),
		DailyTasks:          daily,
		WeeklyTasks:         weekly,
	}, nil
}

func (s *store) getMonthlySummary(ctx context.Context, userID string, month *string) (api.MonthlyPenaltySummary, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.MonthlyPenaltySummary{}, err
	}
	targetMonth := time.Now().In(s.loc).Format("2006-01")
	if month != nil && *month != "" {
		targetMonth = *month
	}
	summary, err := s.ensureMonthSummaryLocked(ctx, teamID, targetMonth)
	if err != nil {
		return api.MonthlyPenaltySummary{}, err
	}
	return monthSummary{
		TeamID:          summary.TeamID,
		Month:           summary.Month,
		DailyPenalty:    int(summary.DailyPenaltyTotal),
		WeeklyPenalty:   int(summary.WeeklyPenaltyTotal),
		IsClosed:        summary.IsClosed,
		TriggeredRuleID: summary.TriggeredPenaltyRuleIds,
	}.toAPI(), nil
}

func (s *store) closeDayForUser(ctx context.Context, userID string) (api.CloseResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.CloseResponse{}, err
	}
	now := time.Now().In(s.loc)
	if err := s.closeDayLocked(ctx, now, teamID); err != nil {
		return api.CloseResponse{}, err
	}
	return api.CloseResponse{ClosedAt: now, Month: now.Format("2006-01")}, nil
}

func (s *store) closeWeekForUser(ctx context.Context, userID string) (api.CloseResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.CloseResponse{}, err
	}
	now := time.Now().In(s.loc)
	if err := s.closeWeekLocked(ctx, now, teamID); err != nil {
		return api.CloseResponse{}, err
	}
	return api.CloseResponse{ClosedAt: now, Month: now.Format("2006-01")}, nil
}

func (s *store) closeMonthForUser(ctx context.Context, userID string) (api.CloseResponse, error) {
	teamID, err := s.primaryTeamLocked(ctx, userID)
	if err != nil {
		return api.CloseResponse{}, err
	}
	now := time.Now().In(s.loc)
	closedMonth, err := s.closeMonthLocked(ctx, now, teamID)
	if err != nil {
		return api.CloseResponse{}, err
	}
	return api.CloseResponse{ClosedAt: now, Month: closedMonth}, nil
}

func (s *store) autoCloseLocked(ctx context.Context, now time.Time, teamID string) error {
	if err := s.closeDayLocked(ctx, now, teamID); err != nil {
		return err
	}
	if err := s.closeWeekLocked(ctx, now, teamID); err != nil {
		return err
	}
	if now.Day() == 1 {
		if _, err := s.closeMonthLocked(ctx, now, teamID); err != nil {
			return err
		}
	}
	return nil
}

func (s *store) closeDayLocked(ctx context.Context, now time.Time, teamID string) error {
	targetDate := dateOnly(now, s.loc).AddDate(0, 0, -1)
	dateKey := targetDate.Format("2006-01-02")
	rows, err := s.q.InsertCloseExecutionKey(ctx, "closed|"+teamID+"|"+dateKey)
	if err != nil {
		return err
	}
	if rows == 0 {
		return nil
	}
	month := targetDate.Format("2006-01")
	if _, err := s.ensureMonthSummaryLocked(ctx, teamID, month); err != nil {
		return err
	}
	tasks, err := s.q.ListActiveTasksByTeamID(ctx, teamID)
	if err != nil {
		return err
	}
	for _, row := range tasks {
		t := taskFromActiveListRow(row, s.loc)
		if t.Type != api.Daily {
			continue
		}
		penaltyKey := fmt.Sprintf("%s|%s|%s", teamID, t.ID, dateKey)
		penRows, err := s.q.InsertCloseExecutionKey(ctx, penaltyKey)
		if err != nil {
			return err
		}
		if penRows == 0 {
			continue
		}
		done, err := s.q.HasTaskCompletion(ctx, dbsqlc.HasTaskCompletionParams{
			TaskID:     t.ID,
			TargetDate: toPgDate(targetDate),
		})
		if err != nil {
			return err
		}
		if !done {
			penalty32, err := safeInt32(t.Penalty, "daily penalty")
			if err != nil {
				return err
			}
			if err := s.q.IncrementDailyPenalty(ctx, dbsqlc.IncrementDailyPenaltyParams{
				TeamID:            teamID,
				Month:             month,
				DailyPenaltyTotal: penalty32,
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *store) closeWeekLocked(ctx context.Context, now time.Time, teamID string) error {
	thisWeekStart := startOfWeek(dateOnly(now, s.loc), s.loc)
	previousWeekStart := thisWeekStart.AddDate(0, 0, -7)
	weekKey := previousWeekStart.Format("2006-01-02")
	rows, err := s.q.InsertCloseExecutionKey(ctx, "closed|"+teamID+"|"+weekKey)
	if err != nil {
		return err
	}
	if rows == 0 {
		return nil
	}
	month := previousWeekStart.Format("2006-01")
	if _, err := s.ensureMonthSummaryLocked(ctx, teamID, month); err != nil {
		return err
	}
	tasks, err := s.q.ListActiveTasksByTeamID(ctx, teamID)
	if err != nil {
		return err
	}
	for _, row := range tasks {
		t := taskFromActiveListRow(row, s.loc)
		if t.Type != api.Weekly {
			continue
		}
		penaltyKey := fmt.Sprintf("%s|%s|%s", teamID, t.ID, weekKey)
		penRows, err := s.q.InsertCloseExecutionKey(ctx, penaltyKey)
		if err != nil {
			return err
		}
		if penRows == 0 {
			continue
		}
		count, err := s.weeklyCompletionCountLocked(ctx, t.ID, previousWeekStart)
		if err != nil {
			return err
		}
		if count < t.Required {
			penalty32, err := safeInt32(t.Penalty, "weekly penalty")
			if err != nil {
				return err
			}
			if err := s.q.IncrementWeeklyPenalty(ctx, dbsqlc.IncrementWeeklyPenaltyParams{
				TeamID:             teamID,
				Month:              month,
				WeeklyPenaltyTotal: penalty32,
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *store) closeMonthLocked(ctx context.Context, now time.Time, teamID string) (string, error) {
	target := now.AddDate(0, -1, 0)
	month := target.Format("2006-01")
	key := teamID + "|" + month
	rows, err := s.q.InsertCloseExecutionKey(ctx, key)
	if err != nil {
		return "", err
	}
	if rows == 0 {
		return month, nil
	}
	summary, err := s.ensureMonthSummaryLocked(ctx, teamID, month)
	if err != nil {
		return "", err
	}
	if summary.IsClosed {
		return month, nil
	}

	activeRules, err := s.q.ListActivePenaltyRulesByTeamID(ctx, teamID)
	if err != nil {
		return "", err
	}
	rules := make([]ruleRecord, 0, len(activeRules))
	for _, row := range activeRules {
		rules = append(rules, ruleFromDB(row, s.loc))
	}
	sort.Slice(rules, func(i, j int) bool { return rules[i].Threshold < rules[j].Threshold })
	total := int(summary.DailyPenaltyTotal + summary.WeeklyPenaltyTotal)
	triggered := []string{}
	for _, r := range rules {
		if total >= r.Threshold {
			triggered = append(triggered, r.ID)
		}
	}
	if err := s.q.CloseMonthlyPenaltySummary(ctx, dbsqlc.CloseMonthlyPenaltySummaryParams{
		TeamID:                  teamID,
		Month:                   month,
		TriggeredPenaltyRuleIds: triggered,
	}); err != nil {
		return "", err
	}
	return month, nil
}

func (s *store) weeklyCompletionCountLocked(ctx context.Context, taskID string, weekStart time.Time) (int, error) {
	weekEnd := weekStart.AddDate(0, 0, 6)
	count, err := s.q.CountTaskCompletionsInRange(ctx, dbsqlc.CountTaskCompletionsInRangeParams{
		TaskID:       taskID,
		TargetDate:   toPgDate(weekStart),
		TargetDate_2: toPgDate(weekEnd),
	})
	if err != nil {
		return 0, err
	}
	return int(count), nil
}

func (s *store) ensureMonthSummaryLocked(ctx context.Context, teamID, month string) (dbsqlc.MonthlyPenaltySummary, error) {
	got, err := s.q.GetMonthlyPenaltySummary(ctx, dbsqlc.GetMonthlyPenaltySummaryParams{
		TeamID: teamID,
		Month:  month,
	})
	if err == nil {
		return got, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return dbsqlc.MonthlyPenaltySummary{}, err
	}
	if err := s.q.UpsertMonthlyPenaltySummary(ctx, dbsqlc.UpsertMonthlyPenaltySummaryParams{
		TeamID:                  teamID,
		Month:                   month,
		DailyPenaltyTotal:       0,
		WeeklyPenaltyTotal:      0,
		IsClosed:                false,
		TriggeredPenaltyRuleIds: []string{},
	}); err != nil {
		return dbsqlc.MonthlyPenaltySummary{}, err
	}
	return s.q.GetMonthlyPenaltySummary(ctx, dbsqlc.GetMonthlyPenaltySummaryParams{
		TeamID: teamID,
		Month:  month,
	})
}

func (s *store) primaryTeamLocked(ctx context.Context, userID string) (string, error) {
	list, err := s.q.ListMembershipsByUserID(ctx, userID)
	if err != nil {
		return "", err
	}
	if len(list) == 0 {
		return "", errors.New("user has no team membership")
	}
	return list[0].TeamID, nil
}

func (s *store) nextID(_ string) string {
	id, err := uuid.NewV7()
	if err != nil {
		// Fallback keeps service alive even if UUIDv7 generation fails unexpectedly.
		return uuid.NewString()
	}
	return id.String()
}

func (u userRecord) toAPI() api.User {
	return api.User{
		Id:          u.ID,
		Email:       u.Email,
		DisplayName: u.Name,
		CreatedAt:   u.CreatedAt,
	}
}

func (t taskRecord) toAPI() api.Task {
	return api.Task{
		Id:                         t.ID,
		TeamId:                     t.TeamID,
		Title:                      t.Title,
		Notes:                      t.Notes,
		Type:                       t.Type,
		PenaltyPoints:              t.Penalty,
		AssigneeUserId:             t.AssigneeID,
		IsActive:                   t.IsActive,
		RequiredCompletionsPerWeek: t.Required,
		CreatedAt:                  t.CreatedAt,
		UpdatedAt:                  t.UpdatedAt,
	}
}

func (r ruleRecord) toAPI() api.PenaltyRule {
	return api.PenaltyRule{
		Id:          r.ID,
		TeamId:      r.TeamID,
		Threshold:   r.Threshold,
		Name:        r.Name,
		Description: r.Description,
		IsActive:    r.IsActive,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
	}
}

func (m monthSummary) toAPI() api.MonthlyPenaltySummary {
	return api.MonthlyPenaltySummary{
		Month:                   m.Month,
		TeamId:                  m.TeamID,
		DailyPenaltyTotal:       m.DailyPenalty,
		WeeklyPenaltyTotal:      m.WeeklyPenalty,
		TotalPenalty:            m.DailyPenalty + m.WeeklyPenalty,
		IsClosed:                m.IsClosed,
		TriggeredPenaltyRuleIds: m.TriggeredRuleID,
	}
}

func taskFromGetRow(row dbsqlc.GetTaskByIDRow, loc *time.Location) taskRecord {
	return taskRecord{
		ID:         row.ID,
		TeamID:     row.TeamID,
		Title:      row.Title,
		Notes:      ptrFromText(row.Notes),
		Type:       api.TaskType(row.Type),
		Penalty:    int(row.PenaltyPoints),
		AssigneeID: ptrFromAny(row.AssigneeUserID),
		IsActive:   row.IsActive,
		Required:   int(row.RequiredCompletionsPerWeek),
		CreatedAt:  row.CreatedAt.Time.In(loc),
		UpdatedAt:  row.UpdatedAt.Time.In(loc),
	}
}

func taskFromListRow(row dbsqlc.ListTasksByTeamIDRow, loc *time.Location) taskRecord {
	return taskRecord{
		ID:         row.ID,
		TeamID:     row.TeamID,
		Title:      row.Title,
		Notes:      ptrFromText(row.Notes),
		Type:       api.TaskType(row.Type),
		Penalty:    int(row.PenaltyPoints),
		AssigneeID: ptrFromAny(row.AssigneeUserID),
		IsActive:   row.IsActive,
		Required:   int(row.RequiredCompletionsPerWeek),
		CreatedAt:  row.CreatedAt.Time.In(loc),
		UpdatedAt:  row.UpdatedAt.Time.In(loc),
	}
}

func taskFromActiveListRow(row dbsqlc.ListActiveTasksByTeamIDRow, loc *time.Location) taskRecord {
	return taskRecord{
		ID:         row.ID,
		TeamID:     row.TeamID,
		Title:      row.Title,
		Notes:      ptrFromText(row.Notes),
		Type:       api.TaskType(row.Type),
		Penalty:    int(row.PenaltyPoints),
		AssigneeID: ptrFromAny(row.AssigneeUserID),
		IsActive:   row.IsActive,
		Required:   int(row.RequiredCompletionsPerWeek),
		CreatedAt:  row.CreatedAt.Time.In(loc),
		UpdatedAt:  row.UpdatedAt.Time.In(loc),
	}
}

func ruleFromDB(row dbsqlc.PenaltyRule, loc *time.Location) ruleRecord {
	return ruleRecord{
		ID:          row.ID,
		TeamID:      row.TeamID,
		Threshold:   int(row.Threshold),
		Name:        row.Name,
		Description: ptrFromText(row.Description),
		IsActive:    row.IsActive,
		CreatedAt:   row.CreatedAt.Time.In(loc),
		UpdatedAt:   row.UpdatedAt.Time.In(loc),
	}
}

func toPgTimestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

func toPgDate(t time.Time) pgtype.Date {
	return pgtype.Date{Time: t, Valid: true}
}

func textFromPtr(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *s, Valid: true}
}

func ptrFromText(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	s := t.String
	return &s
}

func uuidStringFromPtr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func ptrFromUUIDString(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	v := s
	return &v
}

func ptrFromAny(v interface{}) *string {
	switch x := v.(type) {
	case nil:
		return nil
	case string:
		return ptrFromUUIDString(x)
	case []byte:
		return ptrFromUUIDString(string(x))
	default:
		return nil
	}
}

func safeInt32(v int, field string) (int32, error) {
	if v < math.MinInt32 || v > math.MaxInt32 {
		return 0, fmt.Errorf("%s is out of int32 range", field)
	}
	return int32(v), nil
}

func dateOnly(t time.Time, loc *time.Location) time.Time {
	tt := t.In(loc)
	return time.Date(tt.Year(), tt.Month(), tt.Day(), 0, 0, 0, 0, loc)
}

func sameDate(a, b time.Time) bool {
	return a.Format("2006-01-02") == b.Format("2006-01-02")
}

func startOfWeek(t time.Time, loc *time.Location) time.Time {
	tt := dateOnly(t, loc)
	offset := (int(tt.Weekday()) + 6) % 7
	return tt.AddDate(0, 0, -offset)
}

func randomToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func toDate(t time.Time) openapi_types.Date {
	return openapi_types.Date{Time: dateOnly(t, t.Location())}
}
