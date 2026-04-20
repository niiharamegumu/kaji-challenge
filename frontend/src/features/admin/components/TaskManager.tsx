import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Check,
  ChevronDown,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { ChangeEvent } from "react";
import { startTransition, useState } from "react";

import {
  type ReorderTasksRequest,
  type Task,
  TaskType as TaskTypeConst,
  type UpdateTaskRequest,
} from "../../../lib/api/generated/client";
import { FormSheet } from "../../../shared/components/FormSheet";
import { PAGE_SECTION_CHROMELESS_CLASS_NAME } from "../../../shared/styles/pageSection";
import {
  restrictToVerticalAxis,
  smoothSortableLayoutChanges,
  smoothSortableTransition,
} from "../../../shared/utils/sortableAnimation";
import {
  WEEKLY_REQUIRED_COMPLETIONS_PER_WEEK_MAX,
  WEEKLY_REQUIRED_COMPLETIONS_PER_WEEK_MIN,
} from "../constants/tasks";
import type { TaskFormState } from "../state/forms";
import { DeleteConfirmModal } from "./DeleteConfirmModal";

type Props = {
  form: TaskFormState;
  tasks: Task[];
  isCreateOpen: boolean;
  isReordering: boolean;
  showCreateButton?: boolean;
  onCloseCreate: () => void;
  onFormChange: (updater: (prev: TaskFormState) => TaskFormState) => void;
  onOpenCreate: () => void;
  onCreate: () => Promise<void>;
  onDelete: (taskId: string) => void;
  onReorder: (payload: ReorderTasksRequest) => void;
  onUpdate: (taskId: string, payload: UpdateTaskRequest) => Promise<void>;
};

type EditTaskState = {
  title: string;
  notes: string;
};

type PendingDeleteTask = {
  id: string;
  title: string;
};

const MOBILE_SORT_DELAY_MS = 220;
const MOBILE_SORT_TOLERANCE_PX = 8;

type TaskItemsSectionProps = {
  tasks: Task[];
  taskType: "daily" | "weekly";
  isReordering: boolean;
  onDelete: (taskId: string) => void;
  onReorder: (payload: ReorderTasksRequest) => void;
  onUpdate: (taskId: string, payload: UpdateTaskRequest) => Promise<void>;
};

export function TaskCreateForm({
  form,
  onFormChange,
}: {
  form: TaskFormState;
  onFormChange: (updater: (prev: TaskFormState) => TaskFormState) => void;
}) {
  const handleChange =
    (key: keyof TaskFormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      onFormChange((prev) => ({ ...prev, [key]: event.target.value }));
    };

  return (
    <div className="grid gap-1.5">
      <label className="text-xs text-stone-700 sm:text-sm" htmlFor="task-title">
        タスク名
      </label>
      <input
        id="task-title"
        className="h-10 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm sm:h-11"
        value={form.title}
        onChange={handleChange("title")}
      />
      <label className="text-xs text-stone-700 sm:text-sm" htmlFor="task-notes">
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
        {form.type === TaskTypeConst.weekly ? (
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
              min={WEEKLY_REQUIRED_COMPLETIONS_PER_WEEK_MIN}
              max={WEEKLY_REQUIRED_COMPLETIONS_PER_WEEK_MAX}
              value={form.requiredCompletionsPerWeek}
              onChange={handleChange("requiredCompletionsPerWeek")}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SortableTaskItem({
  task,
  isEditing,
  editState,
  onStartEdit,
  onChangeEditState,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  task: Task;
  isEditing: boolean;
  editState: EditTaskState;
  onStartEdit: (task: Task) => void;
  onChangeEditState: (next: EditTaskState) => void;
  onCancelEdit: () => void;
  onSaveEdit: (taskId: string) => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    animateLayoutChanges: smoothSortableLayoutChanges,
    transition: smoothSortableTransition,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
  };
  const canSave = editState.title.trim().length > 0;
  const isWeekly = task.type === TaskTypeConst.weekly;
  const dragProps = isEditing
    ? {}
    : {
        ...attributes,
        ...listeners,
        "aria-label": `${task.title} をドラッグして並び替え`,
      };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`relative rounded-xl border border-stone-200 bg-white p-3 shadow-sm ${isDragging ? "opacity-70 select-none" : ""}`}
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
              onChangeEditState({ ...editState, title: event.target.value })
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
              onChangeEditState({ ...editState, notes: event.target.value })
            }
          />
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              className="flex h-9 items-center gap-1 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 sm:h-10"
              onClick={() => onSaveEdit(task.id)}
              disabled={!canSave}
            >
              <Check size={14} aria-hidden="true" />
              <span>保存</span>
            </button>
            <button
              type="button"
              className="flex h-9 items-center gap-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-700 transition-colors hover:bg-stone-100 sm:h-10"
              onClick={onCancelEdit}
            >
              <X size={14} aria-hidden="true" />
              <span>キャンセル</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-3 pr-10">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-stone-900">{task.title}</div>
              {task.notes != null && task.notes !== "" ? (
                <div className="mt-1 whitespace-pre-wrap break-words text-xs text-stone-600">
                  {task.notes}
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-stone-600">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold leading-4 ${
                    isWeekly
                      ? "bg-stone-900 text-white"
                      : "border border-stone-300 bg-white text-stone-900"
                  }`}
                >
                  {isWeekly ? "週間" : "日間"}
                </span>
                <span>減点 {task.penaltyPoints}</span>
                {isWeekly ? (
                  <span>必要 {task.requiredCompletionsPerWeek}回/週</span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="flex h-9 items-center gap-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs text-stone-700 transition-colors hover:bg-stone-100"
              onClick={() => onStartEdit(task)}
              aria-label="編集"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Pencil size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="flex h-9 items-center gap-1 rounded-lg border border-rose-300 bg-white px-2.5 py-1.5 text-xs text-rose-700 transition-colors hover:bg-rose-50"
              onClick={onDelete}
              aria-label="削除"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
        </>
      )}
      {!isEditing ? (
        <button
          type="button"
          className="absolute top-1/2 right-3 flex h-8 w-8 -translate-y-1/2 cursor-grab touch-none select-none items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400"
          onPointerDown={(event) => event.stopPropagation()}
          {...dragProps}
        >
          <GripVertical size={16} aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}

function TaskItemsSection({
  tasks,
  taskType,
  isReordering,
  onDelete,
  onReorder,
  onUpdate,
}: TaskItemsSectionProps) {
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditTaskState>({
    title: "",
    notes: "",
  });
  const [pendingDeleteTask, setPendingDeleteTask] =
    useState<PendingDeleteTask | null>(null);
  const [optimisticTaskIds, setOptimisticTaskIds] = useState<string[] | null>(
    null,
  );

  const serverTaskIds = tasks.map((task) => task.id);
  const shouldUseOptimisticOrder =
    optimisticTaskIds != null &&
    optimisticTaskIds.length === serverTaskIds.length &&
    optimisticTaskIds.some((taskId, index) => taskId !== serverTaskIds[index]);
  const optimisticTaskIndex =
    shouldUseOptimisticOrder && optimisticTaskIds != null
      ? new Map(optimisticTaskIds.map((taskId, index) => [taskId, index]))
      : null;
  const optimisticTasks =
    optimisticTaskIndex == null
      ? tasks
      : [...tasks].sort(
          (left, right) =>
            (optimisticTaskIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
            (optimisticTaskIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER),
        );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: MOBILE_SORT_DELAY_MS,
        tolerance: MOBILE_SORT_TOLERANCE_PX,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const taskIds = optimisticTasks.map((task) => task.id);
  const sectionTitle = taskType === "daily" ? "毎日" : "週間";
  const emptyMessage =
    taskType === "daily"
      ? "日間タスクはまだありません。"
      : "週間タスクはまだありません。";

  const applyReorder = (activeId: string, overId: string) => {
    if (activeId === overId) {
      return;
    }
    const oldIndex = optimisticTasks.findIndex((task) => task.id === activeId);
    const newIndex = optimisticTasks.findIndex((task) => task.id === overId);
    if (oldIndex < 0 || newIndex < 0) {
      return;
    }
    const nextTasks = arrayMove(optimisticTasks, oldIndex, newIndex).map(
      (task, index) => ({
        ...task,
        position: index + 1,
      }),
    );
    startTransition(() => {
      setOptimisticTaskIds(nextTasks.map((task) => task.id));
    });
    onReorder({ taskIds: nextTasks.map((task) => task.id) });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over == null || active.id === over.id) {
      return;
    }
    applyReorder(String(active.id), String(over.id));
  };

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

  return (
    <>
      <section
        className={`mt-4 rounded-xl px-0 py-3 md:rounded-2xl md:p-6 ${PAGE_SECTION_CHROMELESS_CLASS_NAME}`}
      >
        <div className="flex items-center justify-between gap-3 px-2 md:px-0">
          <div>
            <h3 className="text-base font-semibold text-stone-900">
              {sectionTitle}
            </h3>
            <p className="mt-1 text-sm text-stone-600">
              {taskType === "daily"
                ? "チームで共有する日間タスクです。ここで並び順を調整できます。"
                : "チームで共有する週間タスクです。ここで並び順を調整できます。"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs text-stone-700">
              <span className="whitespace-nowrap">{tasks.length}件</span>
            </span>
            {isReordering ? (
              <span className="text-xs text-stone-500">並び順を保存中...</span>
            ) : null}
          </div>
        </div>

        {optimisticTasks.length === 0 ? (
          <div className="mx-2 mt-4 rounded-xl border border-dashed border-stone-300 bg-stone-50/80 px-4 py-8 text-center text-sm text-stone-600 md:mx-0">
            {emptyMessage}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            modifiers={[restrictToVerticalAxis]}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={taskIds}
              strategy={verticalListSortingStrategy}
            >
              <ul className="mt-4 grid gap-2">
                {optimisticTasks.map((task) => (
                  <SortableTaskItem
                    key={task.id}
                    task={task}
                    isEditing={editingTaskId === task.id}
                    editState={editState}
                    onStartEdit={startEdit}
                    onChangeEditState={setEditState}
                    onCancelEdit={cancelEdit}
                    onSaveEdit={(taskId) => {
                      void saveEdit(taskId);
                    }}
                    onDelete={() =>
                      setPendingDeleteTask({ id: task.id, title: task.title })
                    }
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </section>

      <DeleteConfirmModal
        isOpen={pendingDeleteTask != null}
        title="タスクを削除しますか？"
        message={
          pendingDeleteTask == null
            ? ""
            : `「${pendingDeleteTask.title}」を削除します。この操作は取り消せません。`
        }
        onCancel={() => setPendingDeleteTask(null)}
        onConfirm={() => {
          if (pendingDeleteTask == null) {
            return;
          }
          onDelete(pendingDeleteTask.id);
          setPendingDeleteTask(null);
        }}
      />
    </>
  );
}

export function TaskManager({
  form,
  tasks,
  isCreateOpen,
  isReordering,
  showCreateButton = true,
  onCloseCreate,
  onFormChange,
  onOpenCreate,
  onCreate,
  onDelete,
  onReorder,
  onUpdate,
}: Props) {
  const dailyTasks = tasks.filter((task) => task.type === TaskTypeConst.daily);
  const weeklyTasks = tasks.filter(
    (task) => task.type === TaskTypeConst.weekly,
  );
  const canCreate =
    form.title.trim().length > 0 &&
    (form.type !== TaskTypeConst.weekly ||
      (Number.isInteger(Number(form.requiredCompletionsPerWeek)) &&
        Number(form.requiredCompletionsPerWeek) >=
          WEEKLY_REQUIRED_COMPLETIONS_PER_WEEK_MIN &&
        Number(form.requiredCompletionsPerWeek) <=
          WEEKLY_REQUIRED_COMPLETIONS_PER_WEEK_MAX));

  return (
    <>
      <article
        className={`animate-enter rounded-xl px-0 py-3 md:rounded-2xl md:p-6 ${PAGE_SECTION_CHROMELESS_CLASS_NAME}`}
      >
        <div className="flex items-center justify-between gap-3 px-2 md:px-0">
          <h2 className="text-lg font-semibold text-stone-900">タスク管理</h2>
          {showCreateButton ? (
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-stone-900 text-white transition-colors hover:bg-stone-800"
              onClick={onOpenCreate}
              aria-label="追加"
            >
              <Plus size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <p className="mt-4 border-t border-stone-200 px-2 pt-4 text-xs text-stone-500 md:px-0">
          タスク設定はチーム共通です。並び替えは管理画面でのみ変更できます。
        </p>
      </article>

      <TaskItemsSection
        tasks={dailyTasks}
        taskType="daily"
        isReordering={isReordering}
        onDelete={onDelete}
        onReorder={onReorder}
        onUpdate={onUpdate}
      />
      <TaskItemsSection
        tasks={weeklyTasks}
        taskType="weekly"
        isReordering={isReordering}
        onDelete={onDelete}
        onReorder={onReorder}
        onUpdate={onUpdate}
      />

      <FormSheet
        isOpen={isCreateOpen}
        title="タスクを追加"
        submitLabel="追加する"
        submitIcon={<Plus size={16} aria-hidden="true" />}
        submitDisabled={!canCreate}
        onClose={onCloseCreate}
        onSubmit={() => {
          void onCreate().then(onCloseCreate);
        }}
      >
        <TaskCreateForm form={form} onFormChange={onFormChange} />
      </FormSheet>
    </>
  );
}
