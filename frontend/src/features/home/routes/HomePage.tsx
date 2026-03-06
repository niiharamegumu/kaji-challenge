import { useAtom } from "jotai";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

import { statusMessageAtom } from "../../shell/state/status";
import { DailyTasksPanel } from "../components/DailyTasksPanel";
import { WeeklyTasksPanel } from "../components/WeeklyTasksPanel";
import {
  useHomeQuery,
  useToggleCompletionMutation,
} from "../hooks/useHomeQueries";

export function HomePage() {
  const [, setStatus] = useAtom(statusMessageAtom);
  const homeQuery = useHomeQuery();
  const toggleMutation = useToggleCompletionMutation(setStatus);

  const home = homeQuery.data;

  const weeklyProgress =
    home == null
      ? "0/0"
      : `${home.weeklyTasks.filter((item) => item.weekCompletedCount >= item.requiredCompletionsPerWeek).length}/${home.weeklyTasks.length}`;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return (
    <div className="mt-2 space-y-1.5 md:mt-4 md:space-y-3">
      <section className="grid gap-2 md:grid-cols-2 md:gap-4">
        <DailyTasksPanel
          items={home.dailyTasks}
          onToggle={(taskId) => {
            void toggleMutation.mutateAsync({ taskId, action: "toggle" });
          }}
        />
        <WeeklyTasksPanel
          items={home.weeklyTasks}
          elapsedDaysInWeek={home.elapsedDaysInWeek}
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

      <div className="px-1">
        <Link
          to={`/admin/summary?month=${currentMonth}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-stone-700 underline underline-offset-4 transition-colors hover:text-stone-900"
        >
          <span>今月のサマリーを見る</span>
          <ChevronRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
