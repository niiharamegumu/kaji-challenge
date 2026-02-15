package store

import (
	"context"
	"errors"
	"os"
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

func (s *Store) nextID(_ string) string {
	id, err := uuid.NewV7()
	if err != nil {
		return uuid.NewString()
	}
	return id.String()
}
