import { Check } from "lucide-react";
import type { MonthlyTaskStatusItem } from "../../../lib/api/operations";
import { CompletionSlots } from "../../../shared/components/CompletionSlots";

import type { PastTaskUpdate } from "../hooks/usePastTaskCompletion";

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
          className={`inline-flex items-center justify-center rounded-full transition-opacity hover:opacity-80 ${item.completed ? "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500" : "h-5 w-5 border border-[color:var(--color-matcha-400)] bg-white text-[color:var(--color-matcha-700)] hover:bg-[color:var(--color-matcha-50)]"}`}
          onClick={() => update(item.completed ? "incomplete" : "complete")}
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
    </div>
  );
}
