package http

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/megu/kaji-challenge/backend/internal/http/middleware"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

const (
	authUserIDKey = "auth.userId"
	jstTZ         = "Asia/Tokyo"
)

type Handler struct {
	store *store
}

func NewRouter() *gin.Engine {
	s := newStore()

	r := gin.Default()
	r.Use(middleware.CORS())
	r.Use(authMiddleware(s))
	api.RegisterHandlers(r, &Handler{store: s})
	return r
}

func (h *Handler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, api.HealthResponse{Status: "ok"})
}

func (h *Handler) GetMe(c *gin.Context) {
	user, memberships, err := h.store.currentUserAndMemberships(c.GetString(authUserIDKey))
	if err != nil {
		writeError(c, http.StatusUnauthorized, err.Error())
		return
	}
	c.JSON(http.StatusOK, api.MeResponse{User: user.toAPI(), Memberships: memberships})
}

func (h *Handler) PostAuthOidcGoogleCallback(c *gin.Context) {
	var req api.OidcCallbackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "invalid request body")
		return
	}

	session, err := h.store.loginOrCreateUser(string(req.Email), req.DisplayName)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, session)
}

func (h *Handler) PostTeamInvite(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	var req api.CreateInviteRequest
	if c.Request.ContentLength > 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			writeError(c, http.StatusBadRequest, "invalid request body")
			return
		}
	}

	invite, err := h.store.createInvite(userID, req)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusCreated, invite)
}

func (h *Handler) PostTeamJoin(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	var req api.JoinTeamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "invalid request body")
		return
	}

	res, err := h.store.joinTeam(userID, req.Code)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListTasks(c *gin.Context, params api.ListTasksParams) {
	userID := c.GetString(authUserIDKey)
	items, err := h.store.listTasks(userID, params.Type)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) PostTask(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	var req api.CreateTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "invalid request body")
		return
	}

	task, err := h.store.createTask(userID, req)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusCreated, task)
}

func (h *Handler) PatchTask(c *gin.Context, taskID string) {
	userID := c.GetString(authUserIDKey)
	var req api.UpdateTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "invalid request body")
		return
	}
	task, err := h.store.patchTask(userID, taskID, req)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, task)
}

func (h *Handler) DeleteTask(c *gin.Context, taskID string) {
	userID := c.GetString(authUserIDKey)
	if err := h.store.deleteTask(userID, taskID); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) PostTaskCompletionToggle(c *gin.Context, taskID string) {
	userID := c.GetString(authUserIDKey)
	var req api.ToggleTaskCompletionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "invalid request body")
		return
	}

	res, err := h.store.toggleTaskCompletion(userID, taskID, req.TargetDate.Time)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListPenaltyRules(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	items, err := h.store.listPenaltyRules(userID)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) PostPenaltyRule(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	var req api.CreatePenaltyRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "invalid request body")
		return
	}

	rule, err := h.store.createPenaltyRule(userID, req)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusCreated, rule)
}

func (h *Handler) PatchPenaltyRule(c *gin.Context, ruleID string) {
	userID := c.GetString(authUserIDKey)
	var req api.UpdatePenaltyRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "invalid request body")
		return
	}
	rule, err := h.store.patchPenaltyRule(userID, ruleID, req)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, rule)
}

func (h *Handler) DeletePenaltyRule(c *gin.Context, ruleID string) {
	userID := c.GetString(authUserIDKey)
	if err := h.store.deletePenaltyRule(userID, ruleID); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) GetHome(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	home, err := h.store.getHome(userID)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, home)
}

func (h *Handler) GetPenaltySummaryMonthly(c *gin.Context, params api.GetPenaltySummaryMonthlyParams) {
	userID := c.GetString(authUserIDKey)
	summary, err := h.store.getMonthlySummary(userID, params.Month)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, summary)
}

func (h *Handler) PostAdminCloseDay(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	res, err := h.store.closeDayForUser(userID)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) PostAdminCloseWeek(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	res, err := h.store.closeWeekForUser(userID)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) PostAdminCloseMonth(c *gin.Context) {
	userID := c.GetString(authUserIDKey)
	res, err := h.store.closeMonthForUser(userID)
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, res)
}

type store struct {
	mu sync.Mutex

	loc *time.Location

	ids int64

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

	return &store{
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
	}
}

func authMiddleware(s *store) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}
		path := c.Request.URL.Path
		if path == "/health" || path == "/v1/auth/oidc/google/callback" {
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

		userID, ok := s.lookupSession(token)
		if !ok {
			writeError(c, http.StatusUnauthorized, "invalid bearer token")
			c.Abort()
			return
		}
		c.Set(authUserIDKey, userID)
		c.Next()
	}
}

func (s *store) lookupSession(token string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	userID, ok := s.sessions[token]
	return userID, ok
}

func (s *store) loginOrCreateUser(email, displayName string) (api.AuthSessionResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	email = strings.TrimSpace(strings.ToLower(email))
	displayName = strings.TrimSpace(displayName)
	if email == "" || displayName == "" {
		return api.AuthSessionResponse{}, errors.New("email and displayName are required")
	}

	now := time.Now().In(s.loc)
	userID, ok := s.usersByMail[email]
	if !ok {
		userID = s.nextID("usr")
		s.users[userID] = userRecord{
			ID:        userID,
			Email:     email,
			Name:      displayName,
			CreatedAt: now,
		}
		s.usersByMail[email] = userID
		teamID := s.nextID("team")
		s.memberships[userID] = []membership{{TeamID: teamID, Role: api.Owner}}
	}

	token, err := randomToken()
	if err != nil {
		return api.AuthSessionResponse{}, err
	}
	s.sessions[token] = userID
	user := s.users[userID]

	return api.AuthSessionResponse{
		AccessToken: token,
		User:        user.toAPI(),
	}, nil
}

func (s *store) currentUserAndMemberships(userID string) (userRecord, []api.TeamMembership, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	user, ok := s.users[userID]
	if !ok {
		return userRecord{}, nil, errors.New("user not found")
	}
	memberships := make([]api.TeamMembership, 0, len(s.memberships[userID]))
	for _, m := range s.memberships[userID] {
		memberships = append(memberships, api.TeamMembership{TeamId: m.TeamID, Role: m.Role})
	}
	return user, memberships, nil
}

func (s *store) createInvite(userID string, req api.CreateInviteRequest) (api.InviteCodeResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	teamID, err := s.primaryTeamLocked(userID)
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

	raw, err := randomToken()
	if err != nil {
		return api.InviteCodeResponse{}, err
	}
	code := strings.ToUpper(raw[:10])
	invite := inviteCode{
		Code:      code,
		TeamID:    teamID,
		ExpiresAt: time.Now().In(s.loc).Add(time.Duration(expiresInHours) * time.Hour),
		MaxUses:   maxUses,
		UsedCount: 0,
	}
	s.invites[code] = invite

	return api.InviteCodeResponse{
		Code:      code,
		TeamId:    invite.TeamID,
		ExpiresAt: invite.ExpiresAt,
		MaxUses:   invite.MaxUses,
		UsedCount: invite.UsedCount,
	}, nil
}

func (s *store) joinTeam(userID, code string) (api.JoinTeamResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	code = strings.ToUpper(strings.TrimSpace(code))
	invite, ok := s.invites[code]
	if !ok {
		return api.JoinTeamResponse{}, errors.New("invite code not found")
	}
	now := time.Now().In(s.loc)
	if invite.ExpiresAt.Before(now) {
		return api.JoinTeamResponse{}, errors.New("invite code expired")
	}
	if invite.UsedCount >= invite.MaxUses {
		return api.JoinTeamResponse{}, errors.New("invite code max uses exceeded")
	}

	for _, m := range s.memberships[userID] {
		if m.TeamID == invite.TeamID {
			return api.JoinTeamResponse{TeamId: invite.TeamID}, nil
		}
	}

	s.memberships[userID] = append(s.memberships[userID], membership{TeamID: invite.TeamID, Role: api.Member})
	invite.UsedCount++
	s.invites[code] = invite

	return api.JoinTeamResponse{TeamId: invite.TeamID}, nil
}

func (s *store) listTasks(userID string, filter *api.TaskType) ([]api.Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	teamID, err := s.primaryTeamLocked(userID)
	if err != nil {
		return nil, err
	}
	items := []api.Task{}
	for _, t := range s.tasks {
		if t.TeamID != teamID {
			continue
		}
		if filter != nil && t.Type != *filter {
			continue
		}
		items = append(items, t.toAPI())
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.Before(items[j].CreatedAt) })
	return items, nil
}

func (s *store) createTask(userID string, req api.CreateTaskRequest) (api.Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	teamID, err := s.primaryTeamLocked(userID)
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

	active := true
	if req.IsActive != nil {
		active = *req.IsActive
	}
	now := time.Now().In(s.loc)
	task := taskRecord{
		ID:         s.nextID("tsk"),
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
	s.tasks[task.ID] = task
	return task.toAPI(), nil
}

func (s *store) patchTask(userID, taskID string, req api.UpdateTaskRequest) (api.Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	teamID, err := s.primaryTeamLocked(userID)
	if err != nil {
		return api.Task{}, err
	}
	task, ok := s.tasks[taskID]
	if !ok || task.TeamID != teamID {
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
	s.tasks[task.ID] = task
	return task.toAPI(), nil
}

func (s *store) deleteTask(userID, taskID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	teamID, err := s.primaryTeamLocked(userID)
	if err != nil {
		return err
	}
	task, ok := s.tasks[taskID]
	if !ok || task.TeamID != teamID {
		return errors.New("task not found")
	}
	delete(s.tasks, taskID)
	for key := range s.completions {
		if strings.HasPrefix(key, taskID+"|") {
			delete(s.completions, key)
		}
	}
	return nil
}

func (s *store) toggleTaskCompletion(userID, taskID string, target time.Time) (api.TaskCompletionResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	teamID, err := s.primaryTeamLocked(userID)
	if err != nil {
		return api.TaskCompletionResponse{}, err
	}
	task, ok := s.tasks[taskID]
	if !ok || task.TeamID != teamID {
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

	key := completionKey(taskID, targetDate)
	completed := !s.completions[key]
	if completed {
		s.completions[key] = true
	} else {
		delete(s.completions, key)
	}

	count := s.weeklyCompletionCountLocked(taskID, startOfWeek(targetDate, s.loc))
	return api.TaskCompletionResponse{
		TaskId:               taskID,
		TargetDate:           toDate(targetDate),
		Completed:            completed,
		WeeklyCompletedCount: count,
	}, nil
}

func (s *store) listPenaltyRules(userID string) ([]api.PenaltyRule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	teamID, err := s.primaryTeamLocked(userID)
	if err != nil {
		return nil, err
	}
	items := []api.PenaltyRule{}
	for _, r := range s.rules {
		if r.TeamID == teamID {
			items = append(items, r.toAPI())
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Threshold < items[j].Threshold })
	return items, nil
}

func (s *store) createPenaltyRule(userID string, req api.CreatePenaltyRuleRequest) (api.PenaltyRule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	teamID, err := s.primaryTeamLocked(userID)
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
	s.rules[r.ID] = r
	return r.toAPI(), nil
}

func (s *store) patchPenaltyRule(userID, ruleID string, req api.UpdatePenaltyRuleRequest) (api.PenaltyRule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	teamID, err := s.primaryTeamLocked(userID)
	if err != nil {
		return api.PenaltyRule{}, err
	}
	rule, ok := s.rules[ruleID]
	if !ok || rule.TeamID != teamID {
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
	s.rules[ruleID] = rule
	return rule.toAPI(), nil
}

func (s *store) deletePenaltyRule(userID, ruleID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	teamID, err := s.primaryTeamLocked(userID)
	if err != nil {
		return err
	}
	rule, ok := s.rules[ruleID]
	if !ok || rule.TeamID != teamID {
		return errors.New("rule not found")
	}
	delete(s.rules, ruleID)
	return nil
}

func (s *store) getHome(userID string) (api.HomeResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	teamID, err := s.primaryTeamLocked(userID)
	if err != nil {
		return api.HomeResponse{}, err
	}

	now := time.Now().In(s.loc)
	s.autoCloseLocked(now, teamID)

	today := dateOnly(now, s.loc)
	weekStart := startOfWeek(today, s.loc)
	monthKey := today.Format("2006-01")
	monthly := s.ensureMonthSummaryLocked(teamID, monthKey)
	daily := []api.HomeDailyTask{}
	weekly := []api.HomeWeeklyTask{}

	for _, t := range s.tasks {
		if t.TeamID != teamID || !t.IsActive {
			continue
		}
		if t.Type == api.Daily {
			daily = append(daily, api.HomeDailyTask{
				Task:           t.toAPI(),
				CompletedToday: s.completions[completionKey(t.ID, today)],
			})
			continue
		}
		weekly = append(weekly, api.HomeWeeklyTask{
			Task:                       t.toAPI(),
			WeekCompletedCount:         s.weeklyCompletionCountLocked(t.ID, weekStart),
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
		MonthlyPenaltyTotal: monthly.DailyPenalty + monthly.WeeklyPenalty,
		DailyTasks:          daily,
		WeeklyTasks:         weekly,
	}, nil
}

func (s *store) getMonthlySummary(userID string, month *string) (api.MonthlyPenaltySummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	teamID, err := s.primaryTeamLocked(userID)
	if err != nil {
		return api.MonthlyPenaltySummary{}, err
	}
	targetMonth := time.Now().In(s.loc).Format("2006-01")
	if month != nil && *month != "" {
		targetMonth = *month
	}
	summary := s.ensureMonthSummaryLocked(teamID, targetMonth)
	return summary.toAPI(), nil
}

func (s *store) closeDayForUser(userID string) (api.CloseResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	teamID, err := s.primaryTeamLocked(userID)
	if err != nil {
		return api.CloseResponse{}, err
	}
	now := time.Now().In(s.loc)
	s.closeDayLocked(now, teamID)
	return api.CloseResponse{ClosedAt: now, Month: now.Format("2006-01")}, nil
}

func (s *store) closeWeekForUser(userID string) (api.CloseResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	teamID, err := s.primaryTeamLocked(userID)
	if err != nil {
		return api.CloseResponse{}, err
	}
	now := time.Now().In(s.loc)
	s.closeWeekLocked(now, teamID)
	return api.CloseResponse{ClosedAt: now, Month: now.Format("2006-01")}, nil
}

func (s *store) closeMonthForUser(userID string) (api.CloseResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	teamID, err := s.primaryTeamLocked(userID)
	if err != nil {
		return api.CloseResponse{}, err
	}
	now := time.Now().In(s.loc)
	closedMonth := s.closeMonthLocked(now, teamID)
	return api.CloseResponse{ClosedAt: now, Month: closedMonth}, nil
}

func (s *store) autoCloseLocked(now time.Time, teamID string) {
	s.closeDayLocked(now, teamID)
	s.closeWeekLocked(now, teamID)
	if now.Day() == 1 {
		s.closeMonthLocked(now, teamID)
	}
}

func (s *store) closeDayLocked(now time.Time, teamID string) {
	targetDate := dateOnly(now, s.loc).AddDate(0, 0, -1)
	dateKey := targetDate.Format("2006-01-02")
	if s.dayPenaltyKeys["closed|"+teamID+"|"+dateKey] {
		return
	}
	month := targetDate.Format("2006-01")
	summary := s.ensureMonthSummaryLocked(teamID, month)
	for _, t := range s.tasks {
		if t.TeamID != teamID || t.Type != api.Daily || !t.IsActive {
			continue
		}
		penaltyKey := fmt.Sprintf("%s|%s|%s", teamID, t.ID, dateKey)
		if s.dayPenaltyKeys[penaltyKey] {
			continue
		}
		if !s.completions[completionKey(t.ID, targetDate)] {
			summary.DailyPenalty += t.Penalty
		}
		s.dayPenaltyKeys[penaltyKey] = true
	}
	s.dayPenaltyKeys["closed|"+teamID+"|"+dateKey] = true
}

func (s *store) closeWeekLocked(now time.Time, teamID string) {
	thisWeekStart := startOfWeek(dateOnly(now, s.loc), s.loc)
	previousWeekStart := thisWeekStart.AddDate(0, 0, -7)
	weekKey := previousWeekStart.Format("2006-01-02")
	if s.weekPenaltyKey["closed|"+teamID+"|"+weekKey] {
		return
	}
	month := previousWeekStart.Format("2006-01")
	summary := s.ensureMonthSummaryLocked(teamID, month)
	for _, t := range s.tasks {
		if t.TeamID != teamID || t.Type != api.Weekly || !t.IsActive {
			continue
		}
		penaltyKey := fmt.Sprintf("%s|%s|%s", teamID, t.ID, weekKey)
		if s.weekPenaltyKey[penaltyKey] {
			continue
		}
		if s.weeklyCompletionCountLocked(t.ID, previousWeekStart) < t.Required {
			summary.WeeklyPenalty += t.Penalty
		}
		s.weekPenaltyKey[penaltyKey] = true
	}
	s.weekPenaltyKey["closed|"+teamID+"|"+weekKey] = true
}

func (s *store) closeMonthLocked(now time.Time, teamID string) string {
	target := now.AddDate(0, -1, 0)
	month := target.Format("2006-01")
	key := teamID + "|" + month
	if s.monthClosedKey[key] {
		return month
	}
	summary := s.ensureMonthSummaryLocked(teamID, month)
	if summary.IsClosed {
		s.monthClosedKey[key] = true
		return month
	}

	rules := []ruleRecord{}
	for _, rule := range s.rules {
		if rule.TeamID == teamID && rule.IsActive {
			rules = append(rules, rule)
		}
	}
	sort.Slice(rules, func(i, j int) bool { return rules[i].Threshold < rules[j].Threshold })
	total := summary.DailyPenalty + summary.WeeklyPenalty
	triggered := []string{}
	for _, r := range rules {
		if total >= r.Threshold {
			triggered = append(triggered, r.ID)
		}
	}
	summary.IsClosed = true
	summary.TriggeredRuleID = triggered
	s.monthClosedKey[key] = true
	return month
}

func (s *store) weeklyCompletionCountLocked(taskID string, weekStart time.Time) int {
	count := 0
	for i := 0; i < 7; i++ {
		d := weekStart.AddDate(0, 0, i)
		if s.completions[completionKey(taskID, d)] {
			count++
		}
	}
	return count
}

func (s *store) ensureMonthSummaryLocked(teamID, month string) *monthSummary {
	key := teamID + "|" + month
	if got, ok := s.monthSummaries[key]; ok {
		return got
	}
	s.monthSummaries[key] = &monthSummary{
		TeamID:          teamID,
		Month:           month,
		DailyPenalty:    0,
		WeeklyPenalty:   0,
		IsClosed:        false,
		TriggeredRuleID: []string{},
	}
	return s.monthSummaries[key]
}

func (s *store) primaryTeamLocked(userID string) (string, error) {
	list, ok := s.memberships[userID]
	if !ok || len(list) == 0 {
		return "", errors.New("user has no team membership")
	}
	return list[0].TeamID, nil
}

func (s *store) nextID(prefix string) string {
	s.ids++
	return fmt.Sprintf("%s_%d", prefix, s.ids)
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

func completionKey(taskID string, d time.Time) string {
	return fmt.Sprintf("%s|%s", taskID, d.Format("2006-01-02"))
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

func writeError(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{"message": message})
}
