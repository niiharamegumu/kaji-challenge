INSERT INTO task_completion_daily (task_id, target_date, created_at)
SELECT
  p.task_id,
  (p.week_start + (((s.i - 1) % 7) || ' days')::interval)::date AS target_date,
  NOW()
FROM task_completion_weekly p
JOIN LATERAL generate_series(1, p.completion_count) AS s(i) ON TRUE
WHERE p.completion_count > 0
ON CONFLICT (task_id, target_date) DO NOTHING;

DROP INDEX IF EXISTS idx_task_completion_weekly_week_start;
DROP TABLE IF EXISTS task_completion_weekly;

ALTER TABLE task_completion_daily RENAME TO task_completions;
