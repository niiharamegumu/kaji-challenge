import type { ChangeEvent } from "react";

import {
  type Task,
  type TaskType,
  TaskType as TaskTypeConst,
} from "../../lib/api/generated/client";
import type { TaskFormState } from "../../state/forms";

const taskTypeLabel = (type: TaskType) =>
  type === TaskTypeConst.daily ? "毎日タスク" : "週間タスク";

type Props = {
  form: TaskFormState;
  tasks: Task[];
  onFormChange: (updater: (prev: TaskFormState) => TaskFormState) => void;
  onCreate: () => void;
  onToggleActive: (taskId: string, isActive: boolean) => void;
  onDelete: (taskId: string) => void;
};

export function TaskManager({
  form,
  tasks,
  onFormChange,
  onCreate,
  onToggleActive,
  onDelete,
}: Props) {
  const handleChange = (key: keyof TaskFormState) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    onFormChange((prev) => ({ ...prev, [key]: event.target.value }));
  };

  return (
    <article className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm animate-enter">
      <h2 className="text-lg font-semibold">タスク管理</h2>
      <div className="mt-3 grid gap-2">
        <label className="text-sm text-stone-700" htmlFor="task-title">タスク名</label>
        <input id="task-title" className="rounded-lg border border-stone-300 px-3 py-2" placeholder="タスク名" value={form.title} onChange={handleChange("title")} />
        <label className="text-sm text-stone-700" htmlFor="task-notes">メモ</label>
        <input id="task-notes" className="rounded-lg border border-stone-300 px-3 py-2" placeholder="メモ" value={form.notes} onChange={handleChange("notes")} />
        <div className={`grid gap-2 pr-1 ${form.type === TaskTypeConst.weekly ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2"}`}>
          <div className="grid min-w-0 gap-1">
            <label className="text-sm text-stone-700" htmlFor="task-type">種別</label>
            <select id="task-type" className="h-14 w-full rounded-lg border border-stone-300 px-3 py-2" value={form.type} onChange={handleChange("type")}> 
              <option value={TaskTypeConst.daily}>毎日</option>
              <option value={TaskTypeConst.weekly}>週間</option>
            </select>
          </div>
          <div className="grid min-w-0 gap-1">
            <label className="text-sm text-stone-700" htmlFor="task-penalty-points">未達減点</label>
            <input id="task-penalty-points" className="h-14 w-full rounded-lg border border-stone-300 px-3 py-2" type="number" min={0} value={form.penaltyPoints} onChange={handleChange("penaltyPoints")} />
          </div>
          {form.type === TaskTypeConst.weekly && (
            <div className="grid min-w-0 gap-1">
              <label className="text-sm text-stone-700" htmlFor="task-weekly-required">週間必要回数</label>
              <input id="task-weekly-required" className="h-14 w-full rounded-lg border border-stone-300 px-3 py-2" type="number" min={1} value={form.requiredCompletionsPerWeek} onChange={handleChange("requiredCompletionsPerWeek")} />
            </div>
          )}
        </div>
        <button type="button" className="rounded-lg bg-stone-900 px-3 py-2 text-white" onClick={onCreate}>タスク追加</button>
      </div>
      <ul className="mt-4 space-y-2">
        {tasks.map((task) => (
          <li key={task.id} className="rounded-xl border border-stone-300 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-medium">{task.title}</div>
                <div className="text-xs text-stone-600">
                  {taskTypeLabel(task.type)} / 減点 {task.penaltyPoints}
                  {task.type === TaskTypeConst.weekly && ` / 必要 ${task.requiredCompletionsPerWeek}回/週`} / {task.isActive ? "有効" : "無効"}
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" className="rounded-lg border border-stone-300 px-2 py-1 text-xs" onClick={() => onToggleActive(task.id, task.isActive)}>
                  {task.isActive ? "無効化" : "有効化"}
                </button>
                <button type="button" className="rounded-lg border border-rose-300 px-2 py-1 text-xs text-rose-700" onClick={() => onDelete(task.id)}>
                  削除
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </article>
  );
}
