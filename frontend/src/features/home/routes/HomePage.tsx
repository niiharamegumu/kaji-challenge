import { useAtom } from "jotai";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

import { statusMessageAtom } from "../../shell/state/status";
import { DailyTasksPanel } from "../components/DailyTasksPanel";
import { WeeklyRemindersPanel } from "../components/WeeklyRemindersPanel";
import { WeeklyTasksPanel } from "../components/WeeklyTasksPanel";
import {
  useHomeQuery,
  useToggleCompletionMutation,
} from "../hooks/useHomeQueries";

export function HomePageSkeleton() {
  return (
    <output
      className="mt-2 space-y-1.5 md:mt-4 md:space-y-3"
      aria-label="ホームを読み込み中"
      aria-live="polite"
    >
      <section className="grid gap-2 md:grid-cols-2 md:gap-4">
        {["daily", "weekly"].map((panel) => (
          <article
            key={panel}
            className="animate-pulse rounded-xl border border-stone-200 bg-white/90 p-2.5 shadow-sm md:rounded-2xl md:p-4"
          >
            <div className="h-6 w-28 rounded bg-stone-200" />
            <div className="mt-3 space-y-2">
              {[0, 1, 2].map((row) => (
                <div
                  key={`${panel}-${row}`}
                  className="rounded-xl border border-stone-100 bg-stone-50 p-3"
                >
                  <div className="h-4 w-2/5 rounded bg-stone-200" />
                  <div className="mt-2 h-3 w-4/5 rounded bg-stone-100" />
                  <div className="mt-3 h-3 w-3/5 rounded bg-stone-100" />
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>

      <div className="px-1">
        <div className="h-4 w-36 rounded bg-stone-200" />
      </div>
    </output>
  );
}

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

      <WeeklyRemindersPanel items={home.weeklyReminders} />

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
