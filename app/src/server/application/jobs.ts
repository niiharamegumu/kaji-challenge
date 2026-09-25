import type { Repository, ListActivePushSubscriptionsByTeamIDRow } from "./ports";
import { addDays, todayJST, weekStart } from "../domain/dates";
export const crons = {
  day: "5 15 * * *",
  // Cloudflareの曜日指定はSUN/SATを使い、数字の曜日解釈の違いを避ける。
  week: "10 15 * * SUN",
  daily_2100: "0 12 * * *",
  weekly_prev_sat_1900: "0 10 * * SAT",
  weekly_due_sun_1000: "0 1 * * SUN",
} as const;
export type PushSlot = "daily_2100" | "weekly_prev_sat_1900" | "weekly_due_sun_1000";
export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
  teamId: string;
  slotKind: PushSlot;
}
export interface DeliveryPort {
  claim(
    subscription: ListActivePushSubscriptionsByTeamIDRow,
    slot: PushSlot,
    date: string,
  ): Promise<string | null>;
  send(
    subscription: ListActivePushSubscriptionsByTeamIDRow,
    payload: PushPayload,
  ): Promise<"sent" | "expired">;
  finish(
    subscription: ListActivePushSubscriptionsByTeamIDRow,
    slot: PushSlot,
    date: string,
    claim: string,
  ): Promise<void>;
}
export async function closeOutstanding(
  repository: Repository,
  scope: "day" | "week",
  now: Date,
  notify: (teamId: string) => Promise<void> = async () => {},
) {
  const today = todayJST(now);
  const daysPerPeriod = scope === "day" ? 1 : 7;
  const last = scope === "day" ? addDays(today, -1) : addDays(weekStart(today), -7);
  let periods = 0;
  const failures: string[] = [];
  for (const teamId of await repository.ListTeamIDsForClose()) {
    try {
      if (
        scope === "day" &&
        (await repository.DeleteExpiredOneTimeRemindersByTeam({ TeamID: teamId, StartDate: today }))
      )
        await notify(teamId);
      const latest = await repository.GetLatestCloseRunTargetDate({
        TeamID: teamId,
        Scope: scope === "day" ? "close_day" : "close_week",
      });
      const seed = latest ? "" : await repository.GetEarliestTaskCreatedAtByTeam(teamId);
      if (!latest && !seed) continue;
      let date = latest ? addDays(latest, daysPerPeriod) : todayJST(new Date(seed));
      if (scope === "week") date = weekStart(date);
      for (; date <= last; date = addDays(date, daysPerPeriod)) {
        const closed = await repository.ClosePeriod(teamId, scope, date);
        if (closed) {
          periods++;
          await notify(teamId);
        }
      }
    } catch {
      failures.push(teamId);
    }
  }
  console.info(JSON.stringify({ event: "close_run", scope, periods, failedTeams: failures }));
  if (failures.length) throw new Error(`Closing failed for ${failures.length} teams`);
}
export function pushMessage(slot: PushSlot, tasks: { title: string; remaining: number }[]) {
  const daily = slot === "daily_2100";
  const parts = tasks
    .slice(0, 3)
    .map((t) => (!daily && t.remaining > 1 ? `${t.title}（あと${t.remaining}回）` : t.title));
  if (tasks.length > 3) parts.push(`ほか${tasks.length - 3}件`);
  return {
    title: `${daily ? "今日" : "今週"}の未完了が${tasks.length}件あります`,
    body: `${daily ? "日間" : "週間"}タスク\n${parts.join("、")}`,
  };
}
/** 配信対象の残り回数と購読を取得する。保存や通知はこの読み取りに含めない。 */
async function loadOutstandingTasks(
  repo: Repository,
  teamId: string,
  daily: boolean,
  today: string,
  now: Date,
) {
  const rows = await repo.ListTasksEffectiveForCloseByTeamAndType({
    TeamID: teamId,
    Type: daily ? "daily" : "weekly",
    CreatedAt: now.toISOString(),
  });
  const counts = new Map<string, number>();
  if (daily)
    for (const r of await repo.ListTaskCompletionDailyByTeamAndDate({
      TeamID: teamId,
      TargetDate: today,
    }))
      counts.set(r.TaskID, 1);
  else
    for (const r of await repo.ListTaskCompletionWeeklyCountsByTeamAndWeek({
      TeamID: teamId,
      WeekStart: weekStart(today),
    }))
      counts.set(r.TaskID, r.CompletionCount);
  return {
    tasks: rows
      .map((t) => ({
        title: t.Title,
        remaining: (daily ? 1 : t.RequiredCompletionsPerWeek) - (counts.get(t.ID) ?? 0),
      }))
      .filter((t) => t.remaining > 0),
    subscriptions: await repo.ListActivePushSubscriptionsByTeamID(teamId),
  };
}

export async function notifyOutstanding(
  repository: Repository,
  delivery: DeliveryPort,
  slot: PushSlot,
  now: Date,
) {
  const daily = slot === "daily_2100";
  const today = todayJST(now);
  const date = daily ? today : addDays(weekStart(today), 6);
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const teamId of await repository.ListTeamIDsForPush()) {
    try {
      const snapshot = await loadOutstandingTasks(repository, teamId, daily, today, now);
      if (!snapshot.tasks.length) {
        skipped++;
        continue;
      }
      const payload: PushPayload = {
        ...pushMessage(slot, snapshot.tasks),
        tag: `team:${teamId}:${slot}:${date}`,
        url: "/",
        teamId,
        slotKind: slot,
      };
      for (const subscription of snapshot.subscriptions) {
        try {
          const claim = await delivery.claim(subscription, slot, date);
          if (!claim) {
            skipped++;
            continue;
          }
          const result = await delivery.send(subscription, payload);
          if (result === "expired")
            await repository.DeactivatePushSubscriptionByEndpoint({
              Endpoint: subscription.Endpoint,
              UpdatedAt: now.toISOString(),
            });
          await delivery.finish(subscription, slot, date, claim);
          sent++;
        } catch {
          failed++;
        }
      }
    } catch {
      failed++;
    }
  }
  console.info(JSON.stringify({ event: "push_run", slot, date, sent, skipped, failed }));
  if (failed) throw new Error(`Push failed for ${failed} deliveries or teams`);
}
