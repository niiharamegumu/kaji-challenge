import { Minus, Plus } from "lucide-react";
import type { TaskOverviewWeeklyTask } from "../../../lib/api/generated/client";
import { CompletionSlots } from "../../../shared/components/CompletionSlots";

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
  const normalizedElapsedDaysInWeek = Math.min(
    7,
    Math.max(0, elapsedDaysInWeek),
  );
  const elapsedDaysBeforeToday = Math.max(0, normalizedElapsedDaysInWeek - 1);
  const remainingDaysInWeek = Math.max(0, 7 - elapsedDaysBeforeToday);

  return (
    <article className="animate-enter rounded-xl border border-stone-200 bg-white/90 p-2.5 shadow-sm md:rounded-2xl md:p-4">
      <h2 className="text-lg font-semibold">週間タスク</h2>
      <dl className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <div className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-stone-700">
          <dt className="text-[11px] text-stone-500">経過</dt>
          <dd className="font-medium">{elapsedDaysBeforeToday}日</dd>
        </div>
        <div className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-stone-700">
          <dt className="text-[11px] text-stone-500">残り</dt>
          <dd className="font-medium">{remainingDaysInWeek}日</dd>
        </div>
        <div className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-stone-700">
          <dt className="text-[11px] text-stone-500">進捗</dt>
          <dd className="font-medium">{weeklyProgress}</dd>
        </div>
      </dl>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">週間タスクはありません。</p>
      ) : (
        <ul className="mt-2 space-y-2">
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
                    className={`relative w-full overflow-hidden rounded-xl border p-2.5 text-left transition-colors duration-200 ${isDone ? "border-[color:var(--color-matcha-400)]" : "border-stone-300"}`}
                    onClick={() => onToggle(item.task.id)}
                  >
                    <span
                      className="pointer-events-none absolute inset-y-0 left-0 bg-[color:var(--color-matcha-50)] transition-[width] duration-200 ease-out"
                      style={{ width: progressPercent }}
                      aria-hidden="true"
                    />
                    <div className="relative z-10">
                      <div className="font-medium">{item.task.title}</div>
                      {item.task.notes != null && item.task.notes !== "" ? (
                        <div className="mt-1 whitespace-pre-wrap break-words text-xs text-stone-600">
                          {item.task.notes}
                        </div>
                      ) : null}
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-stone-600">
                          <span className="inline-flex items-center rounded-full bg-stone-900 px-2 py-0.5 font-semibold leading-4 text-white">
                            週間
                          </span>
                          <span>
                            進捗 {item.weekCompletedCount}/
                            {item.requiredCompletionsPerWeek}
                          </span>
                        </div>
                        <CompletionSlots
                          compact
                          className="shrink-0 justify-end"
                          slots={item.completionSlots}
                        />
                      </div>
                    </div>
                  </button>
                </li>
              );
            }

            return (
              <li key={item.task.id} className="relative overflow-visible">
                <div
                  className={`relative overflow-hidden rounded-xl p-2.5 ring-1 ${isDone ? "ring-[color:var(--color-matcha-400)]" : "ring-stone-200"}`}
                >
                  <span
                    className="pointer-events-none absolute inset-y-0 left-0 bg-[color:var(--color-matcha-50)] transition-[width] duration-200 ease-out"
                    style={{ width: progressPercent }}
                    aria-hidden="true"
                  />
                  <span
                    className="pointer-events-none absolute inset-y-2 left-1/2 w-px -translate-x-1/2 border-l border-dashed border-stone-300/70"
                    aria-hidden="true"
                  />
                  <div className="relative z-10 min-w-0">
                    <div className="min-w-0">
                      <div className="font-medium">{item.task.title}</div>
                      {item.task.notes != null && item.task.notes !== "" ? (
                        <div className="mt-1 whitespace-pre-wrap break-words text-xs text-stone-600">
                          {item.task.notes}
                        </div>
                      ) : null}
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-stone-600">
                          <span className="inline-flex items-center rounded-full bg-stone-900 px-2 py-0.5 font-semibold leading-4 text-white">
                            週間
                          </span>
                          <span>
                            進捗 {item.weekCompletedCount}/
                            {item.requiredCompletionsPerWeek}
                          </span>
                        </div>
                        <CompletionSlots
                          compact
                          className="shrink-0 justify-end"
                          slots={item.completionSlots}
                        />
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="absolute inset-y-0 left-0 z-20 w-1/2 touch-manipulation rounded-l-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-matcha-500)] focus-visible:ring-offset-2 disabled:cursor-not-allowed"
                    onClick={() => onDecrement(item.task.id)}
                    disabled={item.weekCompletedCount <= 0}
                    aria-label={`${item.task.title} を1減らす`}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 z-20 w-1/2 touch-manipulation rounded-r-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-matcha-500)] focus-visible:ring-offset-2 disabled:cursor-not-allowed"
                    onClick={() => onIncrement(item.task.id)}
                    disabled={
                      item.weekCompletedCount >= item.requiredCompletionsPerWeek
                    }
                    aria-label={`${item.task.title} を1増やす`}
                  />
                </div>
                <span
                  className={`pointer-events-none absolute top-1/2 left-0 z-30 -translate-x-1/2 -translate-y-1/2 rounded-full p-0.5 shadow-sm transition-colors ${item.weekCompletedCount <= 0 ? "bg-stone-300 text-stone-500" : "bg-stone-900 text-white"}`}
                  aria-hidden="true"
                  data-testid={`weekly-decrement-icon-${item.task.id}`}
                >
                  <Minus size={10} />
                </span>
                <span
                  className={`pointer-events-none absolute top-1/2 right-0 z-30 translate-x-1/2 -translate-y-1/2 rounded-full p-0.5 shadow-sm transition-colors ${item.weekCompletedCount >= item.requiredCompletionsPerWeek ? "bg-stone-300 text-stone-500" : "bg-stone-900 text-white"}`}
                  aria-hidden="true"
                  data-testid={`weekly-increment-icon-${item.task.id}`}
                >
                  <Plus size={10} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
