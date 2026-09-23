import type { Repository, ListActivePushSubscriptionsByTeamIDRow } from "./ports";
import { addDays, todayJST, weekStart } from "../domain/dates";
import { closePeriod } from "./summary";
export const crons = {
  day: "5 15 * * *",
  week: "10 15 * * 0",
  daily_2100: "0 12 * * *",
  weekly_prev_sat_1900: "0 10 * * 6",
  weekly_due_sun_1000: "0 1 * * 0",
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
export async function closeOutstanding(repository: Repository, scope: "day" | "week", now: Date) {
  const today = todayJST(now),
    last = scope === "day" ? addDays(today, -1) : addDays(weekStart(today), -7);
  let periods = 0;
  const failures: string[] = [];
  for (const teamId of await repository.ListTeamIDsForClose()) {
    try {
      const latest = await repository.GetLatestCloseRunTargetDate({
        TeamID: teamId,
        Scope: scope === "day" ? "close_day" : "close_week",
      });
      const seed = latest ? "" : await repository.GetEarliestTaskCreatedAtByTeam(teamId);
      if (!latest && !seed) continue;
      let date = latest ? addDays(latest, scope === "day" ? 1 : 7) : todayJST(new Date(seed));
      if (scope === "week") date = weekStart(date);
      for (; date <= last; date = addDays(date, scope === "day" ? 1 : 7)) {
        const closed = await repository.transaction(async (repo) => {
          if (await closePeriod(repo, teamId, scope, date)) {
            const revision = await repo.GetTeamStateRevision(teamId);
            await repo.UpdateTeamStateRevisionIfMatch({ ID: teamId, StateRevision: revision });
            return true;
          }
          return false;
        });
        if (closed) periods++;
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
export async function notifyOutstanding(
  repository: Repository,
  delivery: DeliveryPort,
  slot: PushSlot,
  now: Date,
) {
  const daily = slot === "daily_2100",
    today = todayJST(now),
    date = daily ? today : addDays(weekStart(today), 6);
  let sent = 0,
    skipped = 0,
    failed = 0;
  for (const teamId of await repository.ListTeamIDsForPush()) {
    try {
      const snapshot = await repository.transaction(async (repo) => {
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
      });
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
