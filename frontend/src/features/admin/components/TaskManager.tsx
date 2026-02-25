import { ChevronDown, CirclePlus, Pencil, Trash2, X } from "lucide-react";
import type { ChangeEvent } from "react";
import { useMemo, useState } from "react";

import {
  type Task,
  TaskType as TaskTypeConst,
  type UpdateTaskRequest,
} from "../../../lib/api/generated/client";
import type { TaskFormState } from "../state/forms";

type Props = {
  form: TaskFormState;
  tasks: Task[];
  onFormChange: (updater: (prev: TaskFormState) => TaskFormState) => void;
  onCreate: () => void;
  onDelete: (taskId: string) => void;
  onUpdate: (taskId: string, payload: UpdateTaskRequest) => Promise<void>;
};

type EditTaskState = {
  title: string;
  notes: string;
};

export function TaskManager({
  form,
  tasks,
  onFormChange,
  onCreate,
  onDelete,
  onUpdate,
}: Props) {
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditTaskState>({
    title: "",
    notes: "",
  });

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

  const startEdit = (task: Task) => {
    setEditingTaskId(task.id);
    setEditState({
      title: task.title,
      notes: task.notes ?? "",
    });
  };

  const cancelEdit = () => {
    setEditingTaskId(null);
    setEditState({ title: "", notes: "" });
  };

  const saveEdit = async (taskId: string) => {
    const title = editState.title.trim();
    if (title.length === 0) {
      return;
    }
    await onUpdate(taskId, {
      title,
      notes: editState.notes,
    });
    cancelEdit();
  };

  const renderTaskCard = (task: Task, weekly: boolean) => {
    const isEditing = editingTaskId === task.id;
    const canSave = editState.title.trim().length > 0;

    return (
      <li
        key={task.id}
        className="rounded-xl border border-stone-200 bg-white p-2.5"
      >
        {isEditing ? (
          <div className="grid gap-2">
            <label
              className="text-xs text-stone-700"
              htmlFor={`task-edit-title-${task.id}`}
            >
              タイトル
            </label>
            <input
              id={`task-edit-title-${task.id}`}
              className="h-10 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm sm:h-11"
              value={editState.title}
              onChange={(event) =>
                setEditState((prev) => ({ ...prev, title: event.target.value }))
              }
            />
            <label
              className="text-xs text-stone-700"
              htmlFor={`task-edit-notes-${task.id}`}
            >
              メモ
            </label>
            <input
              id={`task-edit-notes-${task.id}`}
              className="h-10 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm sm:h-11"
              value={editState.notes}
              onChange={(event) =>
                setEditState((prev) => ({ ...prev, notes: event.target.value }))
              }
            />
          </div>
        ) : (
          <>
            <div className="font-medium text-stone-900">{task.title}</div>
            {task.notes != null && task.notes !== "" ? (
              <div className="mt-1 whitespace-pre-wrap break-words text-xs text-stone-600">
                {task.notes}
              </div>
            ) : null}
          </>
        )}

        {isEditing ? (
          <>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-stone-600">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold leading-4 ${
                  weekly
                    ? "bg-stone-900 text-white"
                    : "border border-stone-300 bg-white text-stone-900"
                }`}
              >
                {weekly ? "週間" : "日間"}
              </span>
              <span>減点 {task.penaltyPoints}</span>
              {weekly ? (
                <span>必要 {task.requiredCompletionsPerWeek}回/週</span>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="flex h-9 items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-xs text-emerald-700 transition-colors duration-200 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 sm:h-11 sm:px-3 sm:py-2"
                onClick={() => {
                  void saveEdit(task.id);
                }}
                disabled={!canSave}
              >
                <span>保存</span>
              </button>
              <button
                type="button"
                className="flex h-9 items-center gap-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs text-stone-700 transition-colors duration-200 hover:bg-stone-100 sm:h-11 sm:px-3 sm:py-2"
                onClick={cancelEdit}
              >
                <X size={14} aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">キャンセル</span>
              </button>
            </div>
          </>
        ) : (
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="min-w-0 flex flex-wrap items-center gap-1.5 text-xs text-stone-600">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold leading-4 ${
                  weekly
                    ? "bg-stone-900 text-white"
                    : "border border-stone-300 bg-white text-stone-900"
                }`}
              >
                {weekly ? "週間" : "日間"}
              </span>
              <span>減点 {task.penaltyPoints}</span>
              {weekly ? (
                <span>必要 {task.requiredCompletionsPerWeek}回/週</span>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-700 transition-colors duration-200 hover:bg-stone-100 sm:h-9 sm:w-9"
                onClick={() => startEdit(task)}
              >
                <Pencil size={14} aria-hidden="true" />
                <span className="sr-only">編集</span>
              </button>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-rose-300 bg-white text-rose-700 transition-colors duration-200 hover:bg-rose-50 sm:h-9 sm:w-9"
                onClick={() => onDelete(task.id)}
              >
                <Trash2 size={14} aria-hidden="true" />
                <span className="sr-only">削除</span>
              </button>
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <article className="animate-enter rounded-xl border border-stone-200 bg-white/90 p-2.5 shadow-sm md:rounded-2xl md:p-6">
      <h2 className="text-lg font-semibold">タスク管理</h2>
      <div className="mt-3 grid gap-1.5">
        <label
          className="text-xs text-stone-700 sm:text-sm"
          htmlFor="task-title"
        >
          タスク名
        </label>
        <input
          id="task-title"
          className="h-10 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm sm:h-11"
          value={form.title}
          onChange={handleChange("title")}
        />
        <label
          className="text-xs text-stone-700 sm:text-sm"
          htmlFor="task-notes"
        >
          メモ
        </label>
        <input
          id="task-notes"
          className="h-10 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm sm:h-11"
          value={form.notes}
          onChange={handleChange("notes")}
        />
        <div
          className={`grid gap-1.5 ${form.type === TaskTypeConst.weekly ? "grid-cols-1 sm:grid-cols-2 md:grid-cols-3" : "grid-cols-1 sm:grid-cols-2"}`}
        >
          <div className="grid min-w-0 gap-1">
            <label
              className="text-xs text-stone-700 sm:text-sm"
              htmlFor="task-type"
            >
              種別
            </label>
            <div className="relative">
              <select
                id="task-type"
                className="h-10 w-full appearance-none rounded-lg border border-stone-300 bg-white py-2 pl-3 pr-10 text-sm sm:h-11 sm:pr-12"
                value={form.type}
                onChange={handleChange("type")}
              >
                <option value={TaskTypeConst.daily}>毎日</option>
                <option value={TaskTypeConst.weekly}>週間</option>
              </select>
              <ChevronDown
                size={18}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 sm:right-4"
                aria-hidden="true"
              />
            </div>
          </div>
          <div className="grid min-w-0 gap-1">
            <label
              className="text-xs text-stone-700 sm:text-sm"
              htmlFor="task-penalty-points"
            >
              未達減点
            </label>
            <input
              id="task-penalty-points"
              className="h-10 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm sm:h-11"
              type="number"
              min={0}
              value={form.penaltyPoints}
              onChange={handleChange("penaltyPoints")}
            />
          </div>
          {form.type === TaskTypeConst.weekly && (
            <div className="grid min-w-0 gap-1">
              <label
                className="text-xs text-stone-700 sm:text-sm"
                htmlFor="task-weekly-required"
              >
                週間必要回数
              </label>
              <input
                id="task-weekly-required"
                className="h-10 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm sm:h-11"
                type="number"
                min={1}
                value={form.requiredCompletionsPerWeek}
                onChange={handleChange("requiredCompletionsPerWeek")}
              />
            </div>
          )}
        </div>
        <div className="mt-1 flex justify-start">
          <button
            type="button"
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-3 py-2 text-sm text-white transition-colors duration-200 hover:bg-stone-800 sm:h-11 sm:w-auto sm:min-w-40"
            onClick={onCreate}
          >
            <CirclePlus size={16} aria-hidden="true" />
            <span>タスク追加</span>
          </button>
        </div>
      </div>
      <div className="mt-4 border-t border-stone-200 pt-3">
        <div>
          <h3 className="text-base font-semibold">毎日</h3>
          {dailyTasks.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">
              日次タスクはまだありません。
            </p>
          ) : (
            <ul className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {dailyTasks.map((task) => renderTaskCard(task, false))}
            </ul>
          )}
        </div>

        <div className="mt-4">
          <h3 className="text-base font-semibold">週間</h3>
          {weeklyTasks.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">
              週次タスクはまだありません。
            </p>
          ) : (
            <ul className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {weeklyTasks.map((task) => renderTaskCard(task, true))}
            </ul>
          )}
        </div>
      </div>
    </article>
  );
}
