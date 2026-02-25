import { useAtom, useAtomValue } from "jotai";
import { useMemo } from "react";
import { Link } from "react-router-dom";

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
  const currentMonth = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  return (
    <div className="mt-2 space-y-2 md:mt-4 md:space-y-4">
      <section className="grid gap-2 md:grid-cols-2 md:gap-4">
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

      <section className="rounded-xl border border-stone-200 bg-white/90 p-2.5 shadow-sm md:rounded-2xl md:p-4">
        <Link
          to={`/admin/summary?month=${currentMonth}`}
          className="text-sm font-medium text-stone-700 underline underline-offset-4 transition-colors hover:text-stone-900"
        >
          今月のサマリーを見る
        </Link>
      </section>
    </div>
  );
}
