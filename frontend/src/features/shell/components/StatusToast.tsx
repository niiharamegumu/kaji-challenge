import { CircleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Props = {
  message: string;
  onDismiss: () => void;
  actionLabel?: string;
  onAction?: () => void;
};

export function StatusToast({
  message,
  onDismiss,
  actionLabel,
  onAction,
}: Props) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const onDismissRef = useRef(onDismiss);
  const onActionRef = useRef(onAction);
  const hasAction = actionLabel != null && onAction != null;

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);

  useEffect(() => {
    if (!message || isHovered || isPressing || hasAction) {
      return;
    }

    const timer = window.setTimeout(() => {
      onDismissRef.current();
    }, 5000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [hasAction, isHovered, isPressing, message]);

  if (!message) {
    return null;
  }

  return (
    <output
      className="fixed right-3 bottom-[calc(env(safe-area-inset-bottom)+6rem)] z-50 w-[min(80vw,22rem)] md:top-4 md:right-4 md:bottom-auto md:w-[22rem]"
      aria-live="polite"
      data-testid="status-message"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onPointerDown={() => setIsPressing(true)}
      onPointerUp={() => setIsPressing(false)}
      onPointerCancel={() => setIsPressing(false)}
      onPointerLeave={() => setIsPressing(false)}
    >
      <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white/95 px-2.5 py-1.5 text-stone-800 shadow-md backdrop-blur">
        <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-xs leading-5 break-words">
          {message}
        </p>
        {hasAction ? (
          <button
            type="button"
            className="shrink-0 rounded-md bg-[color:var(--color-matcha-600)] px-2 py-1 text-xs font-medium text-white transition-colors duration-200 hover:bg-[color:var(--color-matcha-700)]"
            onClick={() => onActionRef.current?.()}
          >
            {actionLabel}
          </button>
        ) : null}
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-stone-600 transition-colors duration-200 hover:bg-stone-50"
          onClick={() => onDismissRef.current()}
          aria-label="ステータスメッセージを閉じる"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </output>
  );
}
