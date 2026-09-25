import { sql, and, eq, type SQL } from "drizzle-orm";
import type { Database } from "./database";
import {
  monthlyPenaltySummaries as summaries,
  monthlyPenaltySummaryTriggeredRules as triggered,
  closeRuns,
} from "./schema";
import { addDays, nextMonth, weekStart } from "../domain/dates";

type SummaryOptions = {
  teamId: string;
  month: string;
  ensureCoverage: boolean;
  closeMonth?: boolean;
  access?: SQL;
};

/** 日次は当月の日付、週次は日曜日が当月に含まれる週だけを計上する。 */
function monthCoverageDates(start: string, end: string) {
  const dates: { scope: "close_day" | "close_week"; date: string }[] = [];
  for (let date = start; date < end; date = addDays(date, 1)) {
    dates.push({ scope: "close_day", date });
  }
  for (let date = weekStart(start); date < end; date = addDays(date, 7)) {
    const sunday = addDays(date, 6);
    if (sunday >= start && sunday < end) dates.push({ scope: "close_week", date });
  }
  return dates;
}

/** 保存・再集計・ルール更新を呼出元のD1 batchへ組み込み、同じcommitで確定する。 */
export function summaryStatements(db: Database, options: SummaryOptions) {
  const { teamId, month, ensureCoverage, closeMonth = false, access = sql`1` } = options;
  const start = month + "-01";
  const end = nextMonth(month);

  // 月次締めの再実行では確定済みの集計を変えない。最後のSQLでclosedにする。
  const allowed = closeMonth
    ? sql`${access} AND NOT EXISTS (
        SELECT 1 FROM monthly_penalty_summaries
        WHERE team_id = ${teamId} AND month_start = ${start} AND is_closed = 1
      )`
    : access;
  const summaryScope = and(
    eq(summaries.team_id, teamId),
    eq(summaries.month_start, start),
    allowed,
  );
  const coverageDates = ensureCoverage ? monthCoverageDates(start, end) : [];

  const createSummary = db
    .insert(summaries)
    .select(sql`SELECT ${teamId}, ${start}, 0, 0, 0 WHERE ${allowed}`)
    .onConflictDoNothing();

  // 日付ごとにSQLを増やさず、月内の不足した締め記録を1文で補う。
  const fillCloseRuns = db
    .insert(closeRuns)
    .select(sql`
      SELECT ${teamId}, json_extract(value, '$.scope'), json_extract(value, '$.date'),
             strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM json_each(${JSON.stringify(coverageDates)})
      WHERE ${allowed}
    `)
    .onConflictDoNothing();

  // JSTの期間終了時点で有効な家事だけを対象に、DBの現在の完了記録から再計算する。
  const dailyPenalty = sql`(
    SELECT COALESCE(SUM(t.penalty_points), 0)
    FROM close_runs c
    JOIN tasks t ON t.team_id = c.team_id AND t.type = 'daily'
      AND t.created_at < strftime('%Y-%m-%dT%H:%M:%fZ', c.target_date, '+1 day', '-9 hours')
      AND (t.deleted_at IS NULL
        OR t.deleted_at >= strftime('%Y-%m-%dT%H:%M:%fZ', c.target_date, '+1 day', '-9 hours'))
    WHERE c.team_id = ${teamId} AND c.scope = 'close_day'
      AND c.target_date >= ${start} AND c.target_date < ${end}
      AND NOT EXISTS (
        SELECT 1 FROM task_completion_daily d
        WHERE d.task_id = t.id AND d.target_date = c.target_date
      )
  )`;
  const weeklyPenalty = sql`(
    SELECT COALESCE(SUM(t.penalty_points), 0)
    FROM close_runs c
    JOIN tasks t ON t.team_id = c.team_id AND t.type = 'weekly'
      AND t.created_at < strftime('%Y-%m-%dT%H:%M:%fZ', c.target_date, '+7 days', '-9 hours')
      AND (t.deleted_at IS NULL
        OR t.deleted_at >= strftime('%Y-%m-%dT%H:%M:%fZ', c.target_date, '+7 days', '-9 hours'))
    WHERE c.team_id = ${teamId} AND c.scope = 'close_week'
      AND date(c.target_date, '+6 days') >= ${start}
      AND date(c.target_date, '+6 days') < ${end}
      AND (
        SELECT COUNT(*) FROM task_completion_weekly_entries w
        WHERE w.task_id = t.id AND w.week_start = c.target_date
      ) < t.required_completions_per_week
  )`;
  const updateTotals = db
    .update(summaries)
    .set({ daily_penalty_total: dailyPenalty, weekly_penalty_total: weeklyPenalty })
    .where(summaryScope);

  // 未締めの月は表示時にルールを評価する。締める月と締め済みの過去修正だけ保存する。
  const clearTriggeredRules = db.delete(triggered).where(sql`
    team_id = ${teamId} AND month_start = ${start} AND ${allowed}
    AND EXISTS (
      SELECT 1 FROM monthly_penalty_summaries
      WHERE team_id = ${teamId} AND month_start = ${start}
        AND (is_closed = 1 OR ${closeMonth ? 1 : 0})
    )
  `);
  const insertTriggeredRules = db
    .insert(triggered)
    .select(sql`
      SELECT r.team_id, s.month_start, r.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM penalty_rules r
      JOIN monthly_penalty_summaries s ON s.team_id = r.team_id
      WHERE s.team_id = ${teamId} AND s.month_start = ${start}
        AND (s.is_closed = 1 OR ${closeMonth ? 1 : 0}) AND r.deleted_at IS NULL
        AND r.threshold <= s.daily_penalty_total + s.weekly_penalty_total
        AND ${allowed}
    `)
    .onConflictDoNothing();

  const statements = [
    createSummary,
    fillCloseRuns,
    updateTotals,
    clearTriggeredRules,
    insertTriggeredRules,
  ] as const;
  if (!closeMonth) return statements;

  const markClosed = db.update(summaries).set({ is_closed: 1 }).where(summaryScope);
  return [...statements, markClosed] as const;
}
