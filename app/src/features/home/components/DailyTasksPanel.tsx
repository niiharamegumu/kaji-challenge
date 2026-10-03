import { Check } from "lucide-react";
import type { TaskOverviewDailyTask } from "../../../lib/api/operations";
import { CompletionSlots } from "../../../shared/components/CompletionSlots";
import { HOME_PANEL_CLASS_NAME } from "./panelStyles";

type Props = {
  items: TaskOverviewDailyTask[];
  pendingTaskIds?: string[];
  onToggle: (taskId: string) => void;
  onToggleAll: () => void;
};

export function DailyTasksPanel({ items, onToggle, onToggleAll, pendingTaskIds = [] }: Props) {
  const completedCount = items.filter((item) => item.completedToday).length;
  const incompleteCount = items.length - completedCount;
  const allCompleted = items.length > 0 && incompleteCount === 0;
  const isSaving = items.some((item) => pendingTaskIds.includes(item.task.id));

  return (
    <article className={HOME_PANEL_CLASS_NAME}>
      <h2 className="px-2 text-lg font-semibold md:px-0">日間タスク</h2>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pl-2 pr-2.5 md:pl-0">
        <dl className="flex flex-wrap items-center gap-1.5 text-xs">
          <div className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-stone-700">
            <dt className="text-[11px] text-stone-500">件数</dt>
            <dd className="font-medium">{items.length}件</dd>
          </div>
          <div className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-stone-700">
            <dt className="text-[11px] text-stone-500">完了</dt>
            <dd className="font-medium">{completedCount}件</dd>
          </div>
          <div className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-stone-700">
            <dt className="text-[11px] text-stone-500">未完了</dt>
            <dd className="font-medium">{incompleteCount}件</dd>
          </div>
        </dl>
        <button
          type="button"
          aria-label={allCompleted ? "すべて未完了" : "すべて完了"}
          title={allCompleted ? "すべて未完了" : "すべて完了"}
          disabled={items.length === 0}
          aria-disabled={items.length === 0 || isSaving}
          aria-busy={isSaving}
          className={`ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${allCompleted ? "border-transparent bg-[color:var(--color-matcha-700)] text-white focus-visible:outline-rose-500" : "border-[color:var(--color-matcha-400)] bg-white text-[color:var(--color-matcha-700)] hover:bg-[color:var(--color-matcha-50)] focus-visible:outline-[color:var(--color-matcha-700)]"}`}
          onClick={() => {
            if (!isSaving) onToggleAll();
          }}
        >
          <Check size={12} aria-hidden="true" />
        </button>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.length === 0 ? (
          <p className="px-2 text-sm text-stone-500 md:px-0">日間タスクはありません。</p>
        ) : (
          items.map((item) => (
            <button
              key={item.task.id}
              type="button"
              disabled={pendingTaskIds.includes(item.task.id)}
              aria-busy={pendingTaskIds.includes(item.task.id)}
              className={`min-h-11 rounded-xl p-2.5 text-left ring-1 transition-colors duration-200 ${item.completedToday ? "bg-[color:var(--color-matcha-50)] ring-[color:var(--color-matcha-400)]" : "bg-white ring-stone-200"}`}
              onClick={() => onToggle(item.task.id)}
            >
              <div className="font-medium">{item.task.title}</div>
              {item.task.notes != null && item.task.notes !== "" ? (
                <div className="mt-1 whitespace-pre-wrap break-words text-xs text-stone-600">
                  {item.task.notes}
                </div>
              ) : null}
              <div className="mt-1 flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-stone-600">
                  <span className="inline-flex items-center rounded-full border border-stone-300 bg-white px-2 py-0.5 font-semibold leading-4 text-stone-900">
                    日間
                  </span>
                  <span>減点 {item.task.penaltyPoints}</span>
                  <span
                    className={
                      item.completedToday
                        ? "text-[color:var(--color-matcha-700)]"
                        : "text-stone-600"
                    }
                  >
                    {item.completedToday ? "完了" : "未完了"}
                  </span>
                </div>
                <CompletionSlots
                  compact
                  className="shrink-0 justify-end"
                  slots={[{ slot: 1, actor: item.completedBy ?? null }]}
                />
              </div>
            </button>
          ))
        )}
      </div>
    </article>
  );
}
