import { Check } from "lucide-react";
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
  onSlotClick?: (slot: TaskCompletionSlot) => void;
  getSlotActionLabel?: (slot: TaskCompletionSlot) => string;
  showEmptyCheck?: boolean;
};

export function CompletionSlots({
  slots,
  compact = false,
  className,
  onSlotClick,
  getSlotActionLabel,
  showEmptyCheck = false,
}: Props) {
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
        const actionLabel = getSlotActionLabel?.(slot);
        const slotContent = (
          <>
            {isDone ? (
              initial
            ) : showEmptyCheck ? (
              <Check
                size={12}
                aria-hidden="true"
                data-testid="completion-slot-empty-check"
              />
            ) : (
              ""
            )}
            <span className="sr-only">
              {isDone ? actor?.effectiveName : fallbackLabel}
            </span>
          </>
        );
        const slotClassName = `inline-flex ${sizeClass} items-center justify-center rounded-full border font-semibold leading-none ${
          isDone
            ? "border-transparent"
            : showEmptyCheck
              ? "border-[color:var(--color-matcha-400)] bg-white text-[color:var(--color-matcha-700)] hover:bg-[color:var(--color-matcha-50)]"
              : "border-stone-300 bg-stone-100 text-stone-500"
        }`;
        const slotStyle = isDone
          ? { backgroundColor: bgColor, color: textColor }
          : undefined;

        return onSlotClick == null ? (
          <span
            key={`slot-${slot.slot}`}
            role="img"
            title={title}
            aria-label={title}
            className={slotClassName}
            style={slotStyle}
          >
            {slotContent}
          </span>
        ) : (
          <button
            key={`slot-${slot.slot}`}
            type="button"
            title={actionLabel == null ? title : `${title}: ${actionLabel}`}
            aria-label={
              actionLabel == null ? title : `${title}: ${actionLabel}`
            }
            className={`${slotClassName} cursor-pointer transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-matcha-500)]`}
            style={slotStyle}
            onClick={() => onSlotClick(slot)}
          >
            {slotContent}
          </button>
        );
      })}
    </div>
  );
}
