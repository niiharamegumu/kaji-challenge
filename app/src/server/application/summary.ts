import type { Repository } from "./ports";
import type * as M from "../../contracts/models";
import * as map from "./mappers";
import { addDays, midnightJST, nextMonth, todayJST, weekday, weekStart } from "../domain/dates";
import { effectiveAt, occurrenceDates } from "../domain/rules";
import { invariant } from "../domain/errors";

export async function ensureSummary(repo: Repository, teamId: string, month: string) {
  try {
    return await repo.GetMonthlyPenaltySummary({ TeamID: teamId, MonthStart: month + "-01" });
  } catch (error) {
    if (!(error instanceof Error) || !("status" in error) || error.status !== 404) throw error;
  }
  await repo.UpsertMonthlyPenaltySummary({
    TeamID: teamId,
    MonthStart: month + "-01",
    DailyPenaltyTotal: 0,
    WeeklyPenaltyTotal: 0,
    IsClosed: false,
  });
  return repo.GetMonthlyPenaltySummary({ TeamID: teamId, MonthStart: month + "-01" });
}
export async function recalculate(
  repo: Repository,
  teamId: string,
  month: string,
  coverage: boolean,
) {
  const start = month + "-01",
    end = nextMonth(month),
    summary = await ensureSummary(repo, teamId, month);
  if (coverage) {
    await repo.InsertDayCloseRunsForMonth({ TeamID: teamId, MonthStart: start, MonthEnd: end });
    await repo.InsertWeekCloseRunsForMonth({
      TeamID: teamId,
      FirstWeekStart: weekStart(start),
      MonthEnd: end,
      MonthStart: start,
    });
  }
  const daily = await repo.SumDailyPenaltyForMonth({
    TeamID: teamId,
    TargetDate: start,
    TargetDate_2: end,
  });
  const weekly = await repo.SumWeeklyPenaltyForMonth({
    TeamID: teamId,
    TargetDate: start,
    TargetDate_2: end,
  });
  await repo.SetMonthPenaltyTotals({
    TeamID: teamId,
    MonthStart: start,
    DailyPenaltyTotal: daily,
    WeeklyPenaltyTotal: weekly,
  });
  if (summary.IsClosed) await replaceRules(repo, teamId, start, daily + weekly);
  return { daily, weekly };
}
async function replaceRules(repo: Repository, teamId: string, start: string, total: number) {
  const rules = await repo.ListUndeletedPenaltyRulesByTeamID(teamId);
  await repo.DeleteTriggeredRulesByMonth({ TeamID: teamId, MonthStart: start });
  for (const r of rules.filter((r) => r.Threshold <= total))
    await repo.AddTriggeredRuleForMonth({ TeamID: teamId, MonthStart: start, RuleID: r.ID });
}
export async function monthCandidate(
  repo: Repository,
  teamId: string,
  now: Date,
): Promise<M.MonthCloseCandidateResponse> {
  try {
    const r = await repo.FindOldestMonthCloseCandidate({
      TeamID: teamId,
      CurrentMonthStart: todayJST(now).slice(0, 7) + "-01",
    });
    const end = addDays(nextMonth(r.MonthStart.slice(0, 7)), -1);
    return {
      candidate: {
        month: r.MonthStart.slice(0, 7),
        dailyThroughDate: end,
        weeklyThroughDate: addDays(end, -weekday(end)),
      },
      pendingMonthCount: r.PendingMonthCount,
    };
  } catch (e) {
    if (e instanceof Error && "status" in e && e.status === 404)
      return { candidate: null, pendingMonthCount: 0 };
    throw e;
  }
}
export async function closeMonth(repo: Repository, teamId: string, month: string, now: Date) {
  invariant(month < todayJST(now).slice(0, 7), "only past months can be closed", 409);
  const summary = await ensureSummary(repo, teamId, month);
  if (summary.IsClosed) return false;
  const candidate = await monthCandidate(repo, teamId, now);
  invariant(
    candidate.candidate?.month === month,
    "month is not the oldest eligible open month",
    409,
  );
  const totals = await recalculate(repo, teamId, month, true);
  await replaceRules(repo, teamId, month + "-01", totals.daily + totals.weekly);
  await repo.CloseMonthlyPenaltySummary({ TeamID: teamId, MonthStart: month + "-01" });
  return true;
}
export async function closePeriod(
  repo: Repository,
  teamId: string,
  scope: "day" | "week",
  date: string,
) {
  const month = (scope === "day" ? date : addDays(date, 6)).slice(0, 7);
  const summary = await ensureSummary(repo, teamId, month);
  // Existing closed-month coverage is authoritative; never increment twice.
  if (summary.IsClosed) return false;
  const inserted = await repo.InsertCloseRun({
    TeamID: teamId,
    Scope: scope === "day" ? "close_day" : "close_week",
    TargetDate: date,
  });
  if (!inserted) return false;
  const cutoff = midnightJST(addDays(date, scope === "day" ? 1 : 7));
  if (scope === "day") {
    const total = await repo.SumDailyPenaltyForClose({
      TeamID: teamId,
      TargetDate: date,
      CreatedAt: cutoff,
    });
    await repo.IncrementDailyPenalty({
      TeamID: teamId,
      MonthStart: month + "-01",
      DailyPenaltyTotal: total,
    });
  } else {
    const total = await repo.SumWeeklyPenaltyForClose({
      TeamID: teamId,
      WeekStart: date,
      CreatedAt: cutoff,
    });
    await repo.IncrementWeeklyPenalty({
      TeamID: teamId,
      MonthStart: month + "-01",
      WeeklyPenaltyTotal: total,
    });
  }
  return true;
}
export async function reminderOccurrences(
  repo: Repository,
  teamId: string,
  from: string,
  to: string,
): Promise<M.ReminderOccurrence[]> {
  const records = await repo.ListRemindersByTeamID(teamId);
  return records
    .flatMap((row) => {
      const r = map.reminder(row);
      return occurrenceDates(r, from, to).map((date) => ({
        reminderId: r.id,
        date,
        title: r.title,
        notes: r.notes,
        kind: r.kind,
        scheduleType: r.scheduleType,
        createdAt: r.createdAt,
      }));
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    .map((r) => ({
      reminderId: r.reminderId,
      date: r.date,
      title: r.title,
      notes: r.notes,
      kind: r.kind,
      scheduleType: r.scheduleType,
    }));
}
export async function overview(
  repo: Repository,
  teamId: string,
  now: Date,
): Promise<M.TaskOverviewResponse> {
  const today = todayJST(now),
    start = weekStart(today),
    month = today.slice(0, 7);
  const summary = await ensureSummary(repo, teamId, month);
  await repo.DeleteExpiredOneTimeRemindersByTeam({ TeamID: teamId, StartDate: today });
  const tasks = await repo.ListTasksByTeamID(teamId);
  const daily = new Map(
    (await repo.ListTaskCompletionDailyByTeamAndDate({ TeamID: teamId, TargetDate: today })).map(
      (r) => [r.TaskID, r],
    ),
  );
  const weekly = await repo.ListTaskCompletionWeeklySlotsByTeamAndWeek({
    TeamID: teamId,
    WeekStart: start,
  });
  return {
    month,
    today,
    elapsedDaysInWeek: ((weekday(today) + 6) % 7) + 1,
    monthlyPenaltyTotal: summary.DailyPenaltyTotal + summary.WeeklyPenaltyTotal,
    dailyTasks: tasks
      .filter((t) => t.Type === "daily")
      .map((t) => ({
        task: map.task(t),
        completedToday: daily.has(t.ID),
        completedBy: daily.has(t.ID) ? map.actor(daily.get(t.ID)!) : undefined,
      })),
    weeklyTasks: tasks
      .filter((t) => t.Type === "weekly")
      .map((t) => {
        const entries = weekly.filter((e) => e.TaskID === t.ID);
        return {
          task: map.task(t),
          weekCompletedCount: entries.length,
          requiredCompletionsPerWeek: t.RequiredCompletionsPerWeek,
          completionSlots: map.slots(
            t.RequiredCompletionsPerWeek,
            new Map(entries.map((e) => [e.Slot, map.actor(e)])),
          ),
        };
      }),
    weeklyReminders: await reminderOccurrences(repo, teamId, today, addDays(start, 6)),
  };
}
export async function monthlySummary(
  repo: Repository,
  teamId: string,
  month: string,
  now: Date,
): Promise<M.MonthlyPenaltySummary> {
  const start = month + "-01",
    end = nextMonth(month),
    today = todayJST(now),
    summary = await ensureSummary(repo, teamId, month);
  const total = summary.DailyPenaltyTotal + summary.WeeklyPenaltyTotal;
  const triggered = summary.IsClosed
    ? await repo.ListTriggeredRuleIDsByMonth({ TeamID: teamId, MonthStart: start })
    : (
        await repo.ListPenaltyRulesEffectiveAtByTeamID({
          TeamID: teamId,
          AsOf: now.toISOString() < midnightJST(end) ? now.toISOString() : midnightJST(end),
        })
      )
        .filter((r) => r.Threshold <= total)
        .map((r) => r.ID);
  const tasks = await repo.ListTasksForMonthlyStatusByTeam({
    TeamID: teamId,
    DeletedAt: midnightJST(start),
    CreatedAt: midnightJST(end),
  });
  const daily = await repo.ListTaskCompletionDailyByMonthAndTeam({
    TeamID: teamId,
    TargetDate: start,
    TargetDate_2: end,
  });
  const weekly = await repo.ListTaskCompletionWeeklySlotsByMonthAndTeam({
    TeamID: teamId,
    WeekStart: weekStart(start),
    WeekStart_2: end,
  });
  const anchors = new Map<string, string>();
  for (let w = weekStart(start); w < end; w = addDays(w, 7))
    if (addDays(w, 6).slice(0, 7) === month) anchors.set(w < start ? start : w, w);
  const groups: M.MonthlyTaskStatusGroup[] = [];
  for (let date = today < end ? today : addDays(end, -1); date >= start; date = addDays(date, -1)) {
    const items: M.MonthlyTaskStatusItem[] = [];
    for (const t of tasks) {
      const w = anchors.get(date),
        cutoff = t.Type === "daily" ? addDays(date, 1) : w ? addDays(w, 7) : null;
      if (!cutoff || !effectiveAt({ createdAt: t.CreatedAt, deletedAt: t.DeletedAt }, cutoff))
        continue;
      const d = daily.find((e) => e.TaskID === t.ID && e.TargetDate === date),
        ws = weekly.filter((e) => e.TaskID === t.ID && e.WeekStart === w);
      invariant(t.Type === "daily" || t.Type === "weekly", "invalid task type");
      items.push({
        taskId: t.ID,
        title: t.Title,
        notes: t.Notes ?? undefined,
        type: t.Type,
        penaltyPoints: t.PenaltyPoints,
        isDeleted: t.DeletedAt !== null,
        completed: t.Type === "daily" ? !!d : ws.length >= t.RequiredCompletionsPerWeek,
        completionSlots:
          t.Type === "daily"
            ? map.slots(1, new Map([[1, d ? map.actor(d) : undefined]]))
            : map.slots(
                t.RequiredCompletionsPerWeek,
                new Map(ws.map((e) => [e.Slot, map.actor(e)])),
              ),
      });
    }
    if (items.length) groups.push({ date, items });
  }
  return {
    teamId,
    month,
    dailyPenaltyTotal: summary.DailyPenaltyTotal,
    weeklyPenaltyTotal: summary.WeeklyPenaltyTotal,
    totalPenalty: total,
    isClosed: summary.IsClosed,
    triggeredPenaltyRuleIds: triggered,
    taskStatusByDate: groups,
  };
}
