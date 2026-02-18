import {
  CheckCircle2,
  ChevronDown,
  CircleMinus,
  CirclePlus,
  Trash2,
} from "lucide-react";
import type { ChangeEvent } from "react";
import { useMemo } from "react";

import {
  type Task,
  type TaskType,
  TaskType as TaskTypeConst,
} from "../../../lib/api/generated/client";
import type { TaskFormState } from "../state/forms";

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
  const handleChange =
    (key: keyof TaskFormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      onFormChange((prev) => ({ ...prev, [key]: event.target.value }));
    };

  const dailyTasks = useMemo(
    () => tasks.filter((task) => task.type === TaskTypeConst.daily),
    [tasks],
  );
  const weeklyTasks = useMemo(
    () => tasks.filter((task) => task.type === TaskTypeConst.weekly),
    [tasks],
  );

  return (
    <article className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm animate-enter md:p-6">
      <h2 className="text-lg font-semibold">タスク管理</h2>
      <div className="mt-4 grid gap-3">
        <label className="text-sm text-stone-700" htmlFor="task-title">
          タスク名
        </label>
        <input
          id="task-title"
          className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 py-2"
          placeholder="タスク名"
          value={form.title}
          onChange={handleChange("title")}
        />
        <label className="text-sm text-stone-700" htmlFor="task-notes">
          メモ
        </label>
        <input
          id="task-notes"
          className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 py-2"
          placeholder="メモ"
          value={form.notes}
          onChange={handleChange("notes")}
        />
        <div
          className={`grid gap-2 ${form.type === TaskTypeConst.weekly ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2"}`}
        >
          <div className="grid min-w-0 gap-1">
            <label className="text-sm text-stone-700" htmlFor="task-type">
              種別
            </label>
            <div className="relative">
              <select
                id="task-type"
                className="min-h-11 w-full appearance-none rounded-lg border border-stone-300 bg-white py-2 pl-3 pr-12"
                value={form.type}
                onChange={handleChange("type")}
              >
                <option value={TaskTypeConst.daily}>毎日</option>
                <option value={TaskTypeConst.weekly}>週間</option>
              </select>
              <ChevronDown
                size={20}
                className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-stone-500"
                aria-hidden="true"
              />
            </div>
          </div>
          <div className="grid min-w-0 gap-1">
            <label
              className="text-sm text-stone-700"
              htmlFor="task-penalty-points"
            >
              未達減点
            </label>
            <input
              id="task-penalty-points"
              className="min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 py-2"
              type="number"
              min={0}
              value={form.penaltyPoints}
              onChange={handleChange("penaltyPoints")}
            />
          </div>
          {form.type === TaskTypeConst.weekly && (
            <div className="grid min-w-0 gap-1">
              <label
                className="text-sm text-stone-700"
                htmlFor="task-weekly-required"
              >
                週間必要回数
              </label>
              <input
                id="task-weekly-required"
                className="min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 py-2"
                type="number"
                min={1}
                value={form.requiredCompletionsPerWeek}
                onChange={handleChange("requiredCompletionsPerWeek")}
              />
            </div>
          )}
        </div>
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-white transition-colors duration-200 hover:bg-stone-800 sm:w-auto sm:min-w-44"
            onClick={onCreate}
          >
            <CirclePlus size={16} aria-hidden="true" />
            <span>タスク追加</span>
          </button>
        </div>
      </div>
      <div className="mt-6 border-t border-stone-200 pt-5">
        <div>
          <h3 className="text-base font-semibold">毎日</h3>
          {dailyTasks.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">
              日次タスクはまだありません。
            </p>
          ) : (
            <ul className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {dailyTasks.map((task) => (
                <li
                  key={task.id}
                  className={`rounded-xl border p-3 ${task.isActive ? "border-[color:var(--color-matcha-300)] bg-[color:var(--color-matcha-50)]" : "border-stone-300 bg-stone-100"}`}
                >
                  <div
                    className={`font-medium ${task.isActive ? "text-stone-900" : "text-stone-700"}`}
                  >
                    {task.title}
                  </div>
                  <div
                    className={`mt-1 text-xs ${task.isActive ? "text-stone-600" : "text-stone-500"}`}
                  >
                    {taskTypeLabel(task.type)} / 減点 {task.penaltyPoints} /{" "}
                    {task.isActive ? "有効" : "無効"}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="flex min-h-11 items-center gap-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs transition-colors duration-200 hover:bg-stone-50"
                      onClick={() => onToggleActive(task.id, task.isActive)}
                    >
                      {task.isActive ? (
                        <CircleMinus size={14} aria-hidden="true" />
                      ) : (
                        <CheckCircle2 size={14} aria-hidden="true" />
                      )}
                      <span>{task.isActive ? "無効化" : "有効化"}</span>
                    </button>
                    <button
                      type="button"
                      className="flex min-h-11 items-center gap-1 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs text-rose-700 transition-colors duration-200 hover:bg-rose-50"
                      onClick={() => onDelete(task.id)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      <span>削除</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6">
          <h3 className="text-base font-semibold">週間</h3>
          {weeklyTasks.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">
              週次タスクはまだありません。
            </p>
          ) : (
            <ul className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {weeklyTasks.map((task) => (
                <li
                  key={task.id}
                  className={`rounded-xl border p-3 ${task.isActive ? "border-[color:var(--color-matcha-300)] bg-[color:var(--color-matcha-50)]" : "border-stone-300 bg-stone-100"}`}
                >
                  <div
                    className={`font-medium ${task.isActive ? "text-stone-900" : "text-stone-700"}`}
                  >
                    {task.title}
                  </div>
                  <div
                    className={`mt-1 text-xs ${task.isActive ? "text-stone-600" : "text-stone-500"}`}
                  >
                    {taskTypeLabel(task.type)} / 減点 {task.penaltyPoints} /
                    必要 {task.requiredCompletionsPerWeek}回/週 /{" "}
                    {task.isActive ? "有効" : "無効"}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="flex min-h-11 items-center gap-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs transition-colors duration-200 hover:bg-stone-50"
                      onClick={() => onToggleActive(task.id, task.isActive)}
                    >
                      {task.isActive ? (
                        <CircleMinus size={14} aria-hidden="true" />
                      ) : (
                        <CheckCircle2 size={14} aria-hidden="true" />
                      )}
                      <span>{task.isActive ? "無効化" : "有効化"}</span>
                    </button>
                    <button
                      type="button"
                      className="flex min-h-11 items-center gap-1 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs text-rose-700 transition-colors duration-200 hover:bg-rose-50"
                      onClick={() => onDelete(task.id)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      <span>削除</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </article>
  );
}
