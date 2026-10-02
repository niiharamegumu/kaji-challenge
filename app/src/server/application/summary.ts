import type { Repository } from "./ports";
import type * as M from "../../contracts/models";
import * as map from "./mappers";
import { addDays, midnightJST, nextMonth, todayJST, weekday, weekStart } from "../domain/dates";
import { effectiveAt, occurrenceDates } from "../domain/rules";
import { invariant } from "../domain/errors";

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

export async function readSummary(repo: Repository, teamId: string, month: string) {
  try {
    return await repo.GetMonthlyPenaltySummary({ TeamID: teamId, MonthStart: month + "-01" });
  } catch (error) {
    if (!(error instanceof Error) || !("status" in error) || error.status !== 404) throw error;
  }
  return {
    TeamID: teamId,
    MonthStart: month + "-01",
    DailyPenaltyTotal: 0,
    WeeklyPenaltyTotal: 0,
    IsClosed: false,
  };
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
  const summary = await readSummary(repo, teamId, month);
  if (summary.IsClosed) return false;
  const candidate = await monthCandidate(repo, teamId, now);
  invariant(
    candidate.candidate?.month === month,
    "month is not the oldest eligible open month",
    409,
  );
  await repo.RecalculateMonth({ teamId, month, ensureCoverage: true, closeMonth: true });
  return true;
}
export async function reminderOccurrences(
  repo: Repository,
  teamId: string,
  from: string,
  to: string,
  today: string = from,
): Promise<M.ReminderOccurrence[]> {
  const records = await repo.ListRemindersByTeamID(teamId, { from, to, today });
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
  const today = todayJST(now);
  const start = weekStart(today);
  const month = today.slice(0, 7);
  const [summary, tasks, dailyEntries, weekly, weeklyReminders] = await Promise.all([
    readSummary(repo, teamId, month),
    repo.ListTasksByTeamID(teamId),
    repo.ListTaskCompletionDailyByTeamAndDate({ TeamID: teamId, TargetDate: today }),
    repo.ListTaskCompletionWeeklySlotsByTeamAndWeek({ TeamID: teamId, WeekStart: start }),
    reminderOccurrences(repo, teamId, today, addDays(start, 6)),
  ]);
  const daily = new Map(dailyEntries.map((entry) => [entry.TaskID, entry]));
  const weeklyByTask = groupBy(weekly, (entry) => entry.TaskID);
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
        const entries = weeklyByTask.get(t.ID) ?? [];
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
    weeklyReminders,
  };
}
export async function monthlySummary(
  repo: Repository,
  teamId: string,
  month: string,
  now: Date,
): Promise<M.MonthlyPenaltySummary> {
  const start = month + "-01";
  const end = nextMonth(month);
  const today = todayJST(now);
  const [summary, tasks, daily, weekly] = await Promise.all([
    readSummary(repo, teamId, month),
    repo.ListTasksForMonthlyStatusByTeam({
      TeamID: teamId,
      DeletedAt: midnightJST(start),
      CreatedAt: midnightJST(end),
    }),
    repo.ListTaskCompletionDailyByMonthAndTeam({
      TeamID: teamId,
      TargetDate: start,
      BeforeDate: end,
    }),
    repo.ListTaskCompletionWeeklySlotsByMonthAndTeam({
      TeamID: teamId,
      WeekStart: weekStart(start),
      BeforeWeekStart: end,
    }),
  ]);
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
  const dailyByTaskAndDate = new Map(
    daily.map((entry) => [`${entry.TaskID}:${entry.TargetDate}`, entry]),
  );
  const weeklyByTaskAndWeek = groupBy(weekly, (entry) => `${entry.TaskID}:${entry.WeekStart}`);
  // 週次は日曜日が当月に入る週だけ表示する。月またぎ週は当月1日の行へ置く。
  const weekByDisplayDate = new Map<string, string>();
  for (let week = weekStart(start); week < end; week = addDays(week, 7)) {
    if (addDays(week, 6).slice(0, 7) === month) {
      weekByDisplayDate.set(week < start ? start : week, week);
    }
  }

  const groups: M.MonthlyTaskStatusGroup[] = [];
  const lastDisplayDate = today < end ? today : addDays(end, -1);
  for (let date = lastDisplayDate; date >= start; date = addDays(date, -1)) {
    const items: M.MonthlyTaskStatusItem[] = [];
    const week = weekByDisplayDate.get(date);
    for (const task of tasks) {
      const dailyTask = task.Type === "daily";
      if (!dailyTask && !week) continue;
      const periodEnd = dailyTask ? addDays(date, 1) : addDays(week!, 7);
      if (!effectiveAt({ createdAt: task.CreatedAt, deletedAt: task.DeletedAt }, periodEnd))
        continue;
      invariant(task.Type === "daily" || task.Type === "weekly", "invalid task type");

      const dailyCompletion = dailyByTaskAndDate.get(`${task.ID}:${date}`);
      const weeklyCompletions = weeklyByTaskAndWeek.get(`${task.ID}:${week}`) ?? [];
      const completionSlots = dailyTask
        ? map.slots(1, new Map([[1, dailyCompletion ? map.actor(dailyCompletion) : undefined]]))
        : map.slots(
            task.RequiredCompletionsPerWeek,
            new Map(weeklyCompletions.map((entry) => [entry.Slot, map.actor(entry)])),
          );
      items.push({
        taskId: task.ID,
        title: task.Title,
        notes: task.Notes ?? undefined,
        type: task.Type,
        penaltyPoints: task.PenaltyPoints,
        isDeleted: task.DeletedAt !== null,
        completed: dailyTask
          ? !!dailyCompletion
          : weeklyCompletions.length >= task.RequiredCompletionsPerWeek,
        completionSlots,
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
