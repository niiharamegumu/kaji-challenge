import type { TaskCompletionSlot } from "../../lib/api/generated/client";
import { getReadableTextColor, resolveUserColor } from "../utils/userColor";

const fallbackLabel = "不明";

const getInitial = (name: string) => {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "?";
  }
  return Array.from(trimmed)[0] ?? "?";
};

type Props = {
  slots: TaskCompletionSlot[];
  compact?: boolean;
  className?: string;
};

export function CompletionSlots({ slots, compact = false, className }: Props) {
  if (slots.length === 0) {
    return null;
  }

  const sizeClass = compact ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-xs";

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
      {slots.map((slot) => {
        const actor = slot.actor;
        const isDone = actor != null;
        const title = isDone
          ? `${slot.slot}回目: ${actor.effectiveName}`
          : `${slot.slot}回目: 未完了`;
        const initial = isDone ? getInitial(actor.effectiveName) : "";
        const bgColor = isDone ? resolveUserColor(actor.colorHex) : "";
        const textColor = isDone ? getReadableTextColor(bgColor) : undefined;

        return (
          <span
            key={`slot-${slot.slot}`}
            title={title}
            aria-label={title}
            className={`inline-flex ${sizeClass} items-center justify-center rounded-full border font-semibold leading-none ${
              isDone
                ? "border-transparent"
                : "border-stone-300 bg-stone-100 text-stone-500"
            }`}
            style={
              isDone
                ? { backgroundColor: bgColor, color: textColor }
                : undefined
            }
          >
            {initial}
            <span className="sr-only">
              {isDone ? actor?.effectiveName : fallbackLabel}
            </span>
          </span>
        );
      })}
    </div>
  );
}
