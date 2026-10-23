import { sql } from "drizzle-orm";
import type { AssistBudget } from "../application/assist-ports";
import { AppError } from "../domain/errors";
import type { Database } from "./database";

export const assistBudgetLimits = { perMinute: 12, perDay: 50, trial: 500 } as const;

export function createAssistBudget(db: Database): AssistBudget {
  return {
    async reserve() {
      // A single conditional UPDATE serializes reservations across all Workers, users and tabs.
      // Use DB time; do not trust browser clocks or reset the trial on redeploy.
      const reserved = await db.get<{ total_count: number }>(sql`
        UPDATE assist_usage SET
          window_count = CASE WHEN window_start <= unixepoch() - 60 THEN 1 ELSE window_count + 1 END,
          window_start = CASE WHEN window_start <= unixepoch() - 60 THEN unixepoch() ELSE window_start END,
          daily_count = CASE WHEN usage_day <> date('now') THEN 1 ELSE daily_count + 1 END,
          usage_day = date('now'),
          total_count = total_count + 1
        WHERE id = 'voice'
          AND total_count < ${assistBudgetLimits.trial}
          AND (usage_day <> date('now') OR daily_count < ${assistBudgetLimits.perDay})
          AND (window_start <= unixepoch() - 60 OR window_count < ${assistBudgetLimits.perMinute})
        RETURNING total_count
      `);
      if (!reserved)
        throw new AppError(
          429,
          "assist_usage_limit",
          "音声アシストの利用上限に達しました。時間をおいても続く場合は、試用上限を確認してください。ToDo画面は使えます。",
        );
    },
  };
}
