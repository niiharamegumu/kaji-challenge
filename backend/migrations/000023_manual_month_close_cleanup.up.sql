DROP TABLE IF EXISTS task_evaluation_dedupes;

DELETE FROM close_runs WHERE scope = 'close_month';

ALTER TABLE close_runs DROP CONSTRAINT close_runs_scope_check;
ALTER TABLE close_runs
  ADD CONSTRAINT close_runs_scope_check CHECK (scope IN ('close_day', 'close_week'));
