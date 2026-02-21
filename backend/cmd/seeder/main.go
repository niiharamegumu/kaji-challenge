package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const jst = "Asia/Tokyo"

type seedTask struct {
	id       string
	title    string
	taskType string
	penalty  int
	required int
}

func main() {
	var (
		month = flag.String("month", "", "target month (YYYY-MM)")
		email = flag.String("email", "", "user email to resolve target team")
	)
	flag.Parse()

	if strings.TrimSpace(*month) == "" {
		log.Fatal("--month is required (YYYY-MM)")
	}
	if strings.TrimSpace(*email) == "" {
		log.Fatal("--email is required")
	}

	loc, err := time.LoadLocation(jst)
	if err != nil || loc == nil {
		loc = time.FixedZone("JST", 9*60*60)
	}

	monthStart, err := time.ParseInLocation("2006-01", *month, loc)
	if err != nil {
		log.Fatalf("invalid --month format: %v", err)
	}
	monthStart = time.Date(monthStart.Year(), monthStart.Month(), 1, 0, 0, 0, 0, loc)
	monthEnd := monthStart.AddDate(0, 1, 0)

	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	db, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		log.Fatalf("failed to connect db: %v", err)
	}
	defer db.Close()

	teamID, err := resolveTeamID(ctx, db, *email)
	if err != nil {
		log.Fatalf("failed to resolve team: %v", err)
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		log.Fatalf("failed to begin tx: %v", err)
	}
	defer func() {
		if rollbackErr := tx.Rollback(ctx); rollbackErr != nil {
			log.Printf("rollback skipped: %v", rollbackErr)
		}
	}()

	seedKey := fmt.Sprintf("seed:%s:%s", teamID, *month)
	tasks := []seedTask{
		{
			id:       taskID(seedKey, "daily-completed"),
			title:    fmt.Sprintf("[SEED %s] Daily 完了タスク", *month),
			taskType: "daily",
			penalty:  2,
			required: 1,
		},
		{
			id:       taskID(seedKey, "daily-pending"),
			title:    fmt.Sprintf("[SEED %s] Daily 未完了タスク", *month),
			taskType: "daily",
			penalty:  1,
			required: 1,
		},
		{
			id:       taskID(seedKey, "weekly-completed"),
			title:    fmt.Sprintf("[SEED %s] Weekly 完了タスク", *month),
			taskType: "weekly",
			penalty:  3,
			required: 2,
		},
		{
			id:       taskID(seedKey, "weekly-pending"),
			title:    fmt.Sprintf("[SEED %s] Weekly 未完了タスク", *month),
			taskType: "weekly",
			penalty:  2,
			required: 2,
		},
	}

	now := time.Now().In(loc)
	for _, t := range tasks {
		if _, err := tx.Exec(ctx, `
INSERT INTO tasks (
  id, team_id, title, notes, type, penalty_points, assignee_user_id, is_active,
  required_completions_per_week, created_at, updated_at, deleted_at
)
VALUES ($1, $2, $3, $4, $5, $6, NULL, TRUE, $7, $8, $9, NULL)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  notes = EXCLUDED.notes,
  type = EXCLUDED.type,
  penalty_points = EXCLUDED.penalty_points,
  is_active = TRUE,
  required_completions_per_week = EXCLUDED.required_completions_per_week,
  updated_at = EXCLUDED.updated_at,
  deleted_at = NULL
`, t.id, teamID, t.title, "dummy data by seed-monthly-dummy", t.taskType, t.penalty, t.required, monthStart, now); err != nil {
			log.Fatalf("failed to upsert task %s: %v", t.title, err)
		}
	}

	dailyCompletedID := tasks[0].id
	if _, err := tx.Exec(ctx, `DELETE FROM task_completion_daily WHERE task_id = $1 AND target_date >= $2 AND target_date < $3`, dailyCompletedID, monthStart, monthEnd); err != nil {
		log.Fatalf("failed to clear daily completions: %v", err)
	}
	for d := monthStart; d.Before(monthEnd); d = d.AddDate(0, 0, 1) {
		if d.Day()%2 == 0 {
			if _, err := tx.Exec(ctx, `
INSERT INTO task_completion_daily (task_id, target_date, created_at)
VALUES ($1, $2, NOW())
ON CONFLICT (task_id, target_date) DO NOTHING
`, dailyCompletedID, d); err != nil {
				log.Fatalf("failed to insert daily completion: %v", err)
			}
		}
	}

	weeklyCompletedID := tasks[2].id
	if _, err := tx.Exec(ctx, `DELETE FROM task_completion_weekly WHERE task_id = $1 AND week_start >= $2 AND week_start < $3`, weeklyCompletedID, monthStart, monthEnd); err != nil {
		log.Fatalf("failed to clear weekly completions: %v", err)
	}
	for w := startOfWeek(monthStart, loc); w.Before(monthEnd); w = w.AddDate(0, 0, 7) {
		if _, err := tx.Exec(ctx, `
INSERT INTO task_completion_weekly (task_id, week_start, completion_count, created_at, updated_at)
VALUES ($1, $2, 2, NOW(), NOW())
ON CONFLICT (task_id, week_start) DO UPDATE SET
  completion_count = EXCLUDED.completion_count,
  updated_at = NOW()
`, weeklyCompletedID, w); err != nil {
			log.Fatalf("failed to insert weekly completion: %v", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		log.Fatalf("failed to commit: %v", err)
	}

	log.Printf("seed completed: month=%s team_id=%s email=%s", *month, teamID, *email)
	log.Printf("tasks: daily(complete/pending), weekly(complete/pending)")
	log.Printf("monthly summary is not seeded; run ops close(day/week/month) to aggregate")
}

func resolveTeamID(ctx context.Context, db *pgxpool.Pool, email string) (string, error) {
	var teamID string
	err := db.QueryRow(ctx, `
SELECT tm.team_id::text
FROM users u
JOIN team_members tm ON tm.user_id = u.id
WHERE lower(u.email) = lower($1)
LIMIT 1
`, email).Scan(&teamID)
	if err != nil {
		return "", err
	}
	return teamID, nil
}

func taskID(seedKey, suffix string) string {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte(seedKey+":"+suffix)).String()
}

func startOfWeek(t time.Time, loc *time.Location) time.Time {
	tt := t.In(loc)
	day := time.Date(tt.Year(), tt.Month(), tt.Day(), 0, 0, 0, 0, loc)
	offset := (int(day.Weekday()) + 6) % 7
	return day.AddDate(0, 0, -offset)
}
