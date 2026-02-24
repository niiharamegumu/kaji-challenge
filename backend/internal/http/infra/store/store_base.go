package store

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	dbsqlc "github.com/megu/kaji-challenge/backend/internal/db/sqlc"
)

func newStore() *Store {
	loc, _ := time.LoadLocation(jstTZ)
	if loc == nil {
		loc = time.FixedZone("JST", 9*60*60)
	}

	s := &Store{
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
	if err := validateSignupGuardSettings(); err != nil {
		panic(err)
	}
	if err := s.initPersistence(); err != nil {
		panic(err)
	}
	return s
}

func NewStore() *Store {
	return newStore()
}

func (s *Store) initPersistence() error {
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return fmt.Errorf("failed to parse DATABASE_URL: %w", err)
	}
	if v := strings.TrimSpace(os.Getenv("DB_POOL_MAX_CONNS")); v != "" {
		maxConns, err := strconv.Atoi(v)
		if err != nil || maxConns <= 0 {
			return fmt.Errorf("DB_POOL_MAX_CONNS must be a positive integer: %q", v)
		}
		config.MaxConns = int32(maxConns)
	}
	if v := strings.TrimSpace(os.Getenv("DB_POOL_MIN_CONNS")); v != "" {
		minConns, err := strconv.Atoi(v)
		if err != nil || minConns < 0 {
			return fmt.Errorf("DB_POOL_MIN_CONNS must be a non-negative integer: %q", v)
		}
		config.MinConns = int32(minConns)
	}
	if v := strings.TrimSpace(os.Getenv("DB_POOL_MAX_CONN_LIFETIME")); v != "" {
		dur, err := time.ParseDuration(v)
		if err != nil || dur <= 0 {
			return fmt.Errorf("DB_POOL_MAX_CONN_LIFETIME must be a positive duration: %q", v)
		}
		config.MaxConnLifetime = dur
	}
	if v := strings.TrimSpace(os.Getenv("DB_POOL_HEALTH_CHECK_PERIOD")); v != "" {
		dur, err := time.ParseDuration(v)
		if err != nil || dur <= 0 {
			return fmt.Errorf("DB_POOL_HEALTH_CHECK_PERIOD must be a positive duration: %q", v)
		}
		config.HealthCheckPeriod = dur
	}
	if config.MinConns > config.MaxConns {
		return fmt.Errorf("DB_POOL_MIN_CONNS (%d) must be <= DB_POOL_MAX_CONNS (%d)", config.MinConns, config.MaxConns)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	db, err := pgxpool.NewWithConfig(ctx, config)
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

func (s *Store) nextID(_ string) string {
	id, err := uuid.NewV7()
	if err != nil {
		return uuid.NewString()
	}
	return id.String()
}
