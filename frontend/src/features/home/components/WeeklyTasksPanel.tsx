import type { TaskOverviewWeeklyTask } from "../../../lib/api/generated/client";

type Props = {
  items: TaskOverviewWeeklyTask[];
  elapsedDaysInWeek: number;
  weeklyProgress: string;
  onToggle: (taskId: string) => void;
};

export function WeeklyTasksPanel({
  items,
  elapsedDaysInWeek,
  weeklyProgress,
  onToggle,
}: Props) {
  return (
    <article className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm animate-enter">
      <h2 className="text-lg font-semibold">今週の週間タスク</h2>
      <p className="mt-1 text-sm text-stone-600">
        経過日数: {elapsedDaysInWeek}日 / 進捗: {weeklyProgress}
      </p>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li
            key={item.task.id}
            className="rounded-xl border border-stone-300 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-medium">{item.task.title}</div>
                <div className="text-sm text-stone-600">
                  {item.weekCompletedCount}/{item.requiredCompletionsPerWeek} 回
                </div>
              </div>
              <button
                type="button"
                className="min-h-11 rounded-lg border border-stone-300 px-3 py-1 text-sm"
                onClick={() => onToggle(item.task.id)}
              >
                {item.requiredCompletionsPerWeek > 1
                  ? "カウントアップ"
                  : "トグル"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </article>
  );
}
