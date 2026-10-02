import { Check } from "lucide-react";
import type { MonthlyTaskStatusItem } from "../../../lib/api/operations";
import { CompletionSlots } from "../../../shared/components/CompletionSlots";

export type PastTaskUpdate = {
  taskId: string;
  targetDate: string;
  type: "daily" | "weekly";
  action: "complete" | "increment" | "decrement";
};

export const pastTaskActionId = (target: Omit<PastTaskUpdate, "action">) =>
  `summary:${target.type}:${target.taskId}:${target.targetDate}`;

export function PastTaskCompletionControl({
  item,
  targetDate,
  isSaving,
  onUpdate,
}: {
  item: MonthlyTaskStatusItem;
  targetDate: string;
  isSaving: boolean;
  onUpdate: (target: PastTaskUpdate) => void;
}) {
  const update = (action: PastTaskUpdate["action"]) => {
    if (!isSaving) onUpdate({ taskId: item.taskId, targetDate, type: item.type, action });
  };

  return (
    <div className="flex items-center gap-1.5" aria-busy={isSaving}>
      {item.type === "daily" ? (
        <button
          type="button"
          aria-label={item.completed ? "過去日タスクを未完了に戻す" : "過去日タスクを完了にする"}
          title={item.completed ? "未完了に戻す" : "完了にする"}
          aria-disabled={isSaving}
          className={`inline-flex items-center justify-center rounded-full transition-opacity hover:opacity-80 aria-disabled:cursor-wait aria-disabled:opacity-50 ${item.completed ? "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500" : "h-5 w-5 border border-[color:var(--color-matcha-400)] bg-white text-[color:var(--color-matcha-700)] hover:bg-[color:var(--color-matcha-50)]"}`}
          onClick={() => update(item.completed ? "decrement" : "complete")}
        >
          {item.completed ? (
            <CompletionSlots compact slots={item.completionSlots} />
          ) : (
            <Check size={12} aria-hidden="true" />
          )}
        </button>
      ) : (
        <CompletionSlots
          compact
          disabled={isSaving}
          className="justify-end"
          slots={item.completionSlots}
          showEmptyCheck
          getSlotActionLabel={(slot) => (slot.actor == null ? "1回追加" : "1回取り消す")}
          onSlotClick={(slot) => update(slot.actor == null ? "increment" : "decrement")}
        />
      )}
      {isSaving ? (
        <span role="status" className="whitespace-nowrap text-xs text-stone-500">
          保存中…
        </span>
      ) : null}
    </div>
  );
}
