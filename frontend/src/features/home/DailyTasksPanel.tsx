import type { HomeDailyTask } from "../../lib/api/generated/client";

type Props = {
  items: HomeDailyTask[];
  onToggle: (taskId: string) => void;
};

export function DailyTasksPanel({ items, onToggle }: Props) {
  return (
    <article className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm animate-enter">
      <h2 className="text-lg font-semibold">今日の毎日タスク</h2>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <button
            key={item.task.id}
            type="button"
            className={`rounded-xl border p-3 text-left transition-colors duration-200 ${item.completedToday ? "border-[color:var(--color-matcha-400)] bg-[color:var(--color-matcha-50)]" : "border-stone-300"}`}
            onClick={() => onToggle(item.task.id)}
          >
            <div className="font-medium">{item.task.title}</div>
            <div className="text-sm text-stone-600">未達減点: {item.task.penaltyPoints}</div>
            <div className="mt-1 text-xs">{item.completedToday ? "完了" : "未完了"}</div>
          </button>
        ))}
      </div>
    </article>
  );
}
