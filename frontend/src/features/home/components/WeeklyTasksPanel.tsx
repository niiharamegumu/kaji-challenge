import type { TaskOverviewWeeklyTask } from "../../../lib/api/generated/client";

type Props = {
  items: TaskOverviewWeeklyTask[];
  elapsedDaysInWeek: number;
  weeklyProgress: string;
  onToggle: (taskId: string) => void;
  onIncrement: (taskId: string) => void;
  onDecrement: (taskId: string) => void;
};

export function WeeklyTasksPanel({
  items,
  elapsedDaysInWeek,
  weeklyProgress,
  onToggle,
  onIncrement,
  onDecrement,
}: Props) {
  const remainingDaysInWeek = Math.max(0, 7 - elapsedDaysInWeek);

  return (
    <article className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm animate-enter">
      <h2 className="text-lg font-semibold">今週の週間タスク</h2>
      <dl className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <div className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1.5 text-stone-700">
          <dt className="text-xs text-stone-500">経過</dt>
          <dd className="font-medium">{elapsedDaysInWeek}日</dd>
        </div>
        <div className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1.5 text-stone-700">
          <dt className="text-xs text-stone-500">残り</dt>
          <dd className="font-medium">{remainingDaysInWeek}日</dd>
        </div>
        <div className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1.5 text-stone-700">
          <dt className="text-xs text-stone-500">進捗</dt>
          <dd className="font-medium">{weeklyProgress}</dd>
        </div>
      </dl>
      <ul className="mt-3 space-y-2">
        {items.map((item) => {
          const isSingleCompletion = item.requiredCompletionsPerWeek <= 1;
          const progressRatio = Math.max(
            0,
            Math.min(
              1,
              item.requiredCompletionsPerWeek > 0
                ? item.weekCompletedCount / item.requiredCompletionsPerWeek
                : 0,
            ),
          );
          const progressPercent = `${progressRatio * 100}%`;
          const isDone =
            item.weekCompletedCount >= item.requiredCompletionsPerWeek;
          if (isSingleCompletion) {
            return (
              <li key={item.task.id}>
                <button
                  type="button"
                  className={`relative w-full overflow-hidden rounded-xl border p-3 text-left transition-colors duration-200 ${isDone ? "border-[color:var(--color-matcha-400)]" : "border-stone-300"}`}
                  onClick={() => onToggle(item.task.id)}
                >
                  <span
                    className="pointer-events-none absolute inset-y-0 left-0 bg-[color:var(--color-matcha-50)] transition-[width] duration-200 ease-out"
                    style={{ width: progressPercent }}
                    aria-hidden="true"
                  />
                  <div className="relative z-10">
                    <div className="font-medium">{item.task.title}</div>
                    <div className="text-sm text-stone-600">
                      {item.weekCompletedCount}/
                      {item.requiredCompletionsPerWeek} 回
                    </div>
                  </div>
                </button>
              </li>
            );
          }

          return (
            <li
              key={item.task.id}
              className={`relative overflow-hidden rounded-xl p-3 ring-1 ${isDone ? "ring-[color:var(--color-matcha-400)]" : "ring-stone-200"}`}
            >
              <span
                className="pointer-events-none absolute inset-y-0 left-0 bg-[color:var(--color-matcha-50)] transition-[width] duration-200 ease-out"
                style={{ width: progressPercent }}
                aria-hidden="true"
              />
              <div className="relative z-10 flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{item.task.title}</div>
                  <div className="text-sm text-stone-600">
                    {item.weekCompletedCount}/{item.requiredCompletionsPerWeek}{" "}
                    回
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="min-h-11 min-w-11 rounded-lg border border-stone-300 bg-white/90 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => onDecrement(item.task.id)}
                    disabled={item.weekCompletedCount <= 0}
                    aria-label={`${item.task.title} をカウントダウン`}
                  >
                    -
                  </button>
                  <button
                    type="button"
                    className="min-h-11 min-w-11 rounded-lg border border-stone-300 bg-white/90 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => onIncrement(item.task.id)}
                    disabled={
                      item.weekCompletedCount >= item.requiredCompletionsPerWeek
                    }
                    aria-label={`${item.task.title} をカウントアップ`}
                  >
                    +
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
