package store

import (
	"log"
	"time"
)

func (s *Store) logSQLPerformance(operation string, startedAt time.Time, queryCount int, details string) {
	log.Printf("store_perf operation=%s elapsed_ms=%d tracked_sql_queries=%d %s", operation, time.Since(startedAt).Milliseconds(), queryCount, details)
}
