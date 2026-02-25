import type { TaskOverviewDailyTask } from "../../../lib/api/generated/client";

type Props = {
  items: TaskOverviewDailyTask[];
  onToggle: (taskId: string) => void;
};

export function DailyTasksPanel({ items, onToggle }: Props) {
  return (
    <article className="animate-enter rounded-xl border border-stone-200 bg-white/90 p-2.5 shadow-sm md:rounded-2xl md:p-4">
      <h2 className="text-lg font-semibold">今日の毎日タスク</h2>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <button
            key={item.task.id}
            type="button"
            className={`min-h-11 rounded-xl p-2.5 text-left ring-1 transition-colors duration-200 ${item.completedToday ? "bg-[color:var(--color-matcha-50)] ring-[color:var(--color-matcha-400)]" : "bg-stone-50 ring-stone-200"}`}
            onClick={() => onToggle(item.task.id)}
          >
            <div className="font-medium">{item.task.title}</div>
            {item.task.notes != null && item.task.notes !== "" ? (
              <div className="mt-1 whitespace-pre-wrap break-words text-xs text-stone-600">
                {item.task.notes}
              </div>
            ) : null}
            <div className="text-sm text-stone-600">
              未達減点: {item.task.penaltyPoints}
            </div>
            <div className="mt-1 text-xs">
              {item.completedToday ? "完了" : "未完了"}
            </div>
          </button>
        ))}
      </div>
    </article>
  );
}
