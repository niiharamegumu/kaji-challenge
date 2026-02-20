import { useAtom, useAtomValue } from "jotai";
import { useMemo } from "react";

import { isLoggedInAtom } from "../../../state/session";
import { statusMessageAtom } from "../../shell/state/status";
import { DailyTasksPanel } from "../components/DailyTasksPanel";
import { WeeklyTasksPanel } from "../components/WeeklyTasksPanel";
import {
  useHomeQuery,
  useToggleCompletionMutation,
} from "../hooks/useHomeQueries";

export function HomePage() {
  const loggedIn = useAtomValue(isLoggedInAtom);
  const [, setStatus] = useAtom(statusMessageAtom);
  const homeQuery = useHomeQuery(loggedIn);
  const toggleMutation = useToggleCompletionMutation(setStatus);

  const home = homeQuery.data;

  const weeklyProgress = useMemo(() => {
    if (home == null) {
      return "0/0";
    }
    const completedTasks = home.weeklyTasks.filter(
      (item) => item.weekCompletedCount >= item.requiredCompletionsPerWeek,
    ).length;
    const totalTasks = home.weeklyTasks.length;
    return `${completedTasks}/${totalTasks}`;
  }, [home]);

  return (
    <section className="mt-4 grid gap-4 md:grid-cols-2">
      <DailyTasksPanel
        items={home?.dailyTasks ?? []}
        onToggle={(taskId) => {
          void toggleMutation.mutateAsync({ taskId, action: "toggle" });
        }}
      />
      <WeeklyTasksPanel
        items={home?.weeklyTasks ?? []}
        elapsedDaysInWeek={home?.elapsedDaysInWeek ?? 0}
        weeklyProgress={weeklyProgress}
        onToggle={(taskId) => {
          void toggleMutation.mutateAsync({ taskId, action: "toggle" });
        }}
        onIncrement={(taskId) => {
          void toggleMutation.mutateAsync({ taskId, action: "increment" });
        }}
        onDecrement={(taskId) => {
          void toggleMutation.mutateAsync({ taskId, action: "decrement" });
        }}
      />
    </section>
  );
}
