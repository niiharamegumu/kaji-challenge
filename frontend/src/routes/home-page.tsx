import { useAtom } from "jotai";
import { useAtomValue } from "jotai";
import { useMemo } from "react";

import { DailyTasksPanel } from "../features/home/DailyTasksPanel";
import { WeeklyTasksPanel } from "../features/home/WeeklyTasksPanel";
import {
  useHomeQuery,
  useMonthlySummaryQuery,
  useToggleCompletionMutation,
} from "../features/api/hooks";
import { isLoggedInAtom } from "../state/session";
import { statusMessageAtom } from "../state/ui";

export function HomePage() {
  const loggedIn = useAtomValue(isLoggedInAtom);
  const [, setStatus] = useAtom(statusMessageAtom);
  const homeQuery = useHomeQuery(loggedIn);
  const summaryQuery = useMonthlySummaryQuery(loggedIn);
  const toggleMutation = useToggleCompletionMutation(setStatus);

  const home = homeQuery.data;
  const monthlyTotal = summaryQuery.data?.totalPenalty ?? 0;

  const weeklyProgress = useMemo(() => {
    if (home == null) {
      return "0/0";
    }
    const done = home.weeklyTasks.reduce(
      (acc, item) =>
        acc + Math.min(item.weekCompletedCount, item.requiredCompletionsPerWeek),
      0,
    );
    const total = home.weeklyTasks.reduce(
      (acc, item) => acc + item.requiredCompletionsPerWeek,
      0,
    );
    return `${done}/${total}`;
  }, [home]);

  return (
    <section className="mt-4 grid gap-4 md:grid-cols-2">
      <DailyTasksPanel
        items={home?.dailyTasks ?? []}
        onToggle={(taskId) => {
          void toggleMutation.mutateAsync(taskId);
        }}
      />
      <WeeklyTasksPanel
        items={home?.weeklyTasks ?? []}
        elapsedDaysInWeek={home?.elapsedDaysInWeek ?? 0}
        weeklyProgress={weeklyProgress}
        monthlyTotal={monthlyTotal}
        onToggle={(taskId) => {
          void toggleMutation.mutateAsync(taskId);
        }}
      />
    </section>
  );
}
