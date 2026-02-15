package infra

import (
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
	api "github.com/megu/kaji-challenge/backend/internal/openapi/generated"
)

const (
	authUserIDKey = "auth.userId"
	authTokenKey  = "auth.token"
	jstTZ         = "Asia/Tokyo"
)

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
