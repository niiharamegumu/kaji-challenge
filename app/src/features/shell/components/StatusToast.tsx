import { CircleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Props = {
  message: string;
  onDismiss: () => void;
  actionLabel?: string;
  onAction?: () => void;
  autoDismiss?: boolean;
};

export function StatusToast({
  message,
  onDismiss,
  actionLabel,
  onAction,
  autoDismiss = true,
}: Props) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const onDismissRef = useRef(onDismiss);
  const hasAction = actionLabel != null && onAction != null;

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    // The toast lifetime is keyed to the visible message itself.
    // Optional actions can appear or disappear without restarting the timer.
    if (!autoDismiss || !message || isHovered || isPressing) {
      return;
    }

    const timer = window.setTimeout(() => {
      onDismissRef.current();
    }, 5000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [autoDismiss, isHovered, isPressing, message]);

  if (!message) {
    return null;
  }

  return (
    <output
      // Fixed positioning bypasses the main layout's safe-area padding, including in the PWA.
      className="fixed top-[calc(env(safe-area-inset-top,0px)+12px)] right-[calc(env(safe-area-inset-right,0px)+8px)] z-50 w-[min(80vw,22rem)]"
      aria-live="polite"
      data-testid="status-message"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onPointerDown={() => setIsPressing(true)}
      onPointerUp={() => setIsPressing(false)}
      onPointerCancel={() => setIsPressing(false)}
      onPointerLeave={() => setIsPressing(false)}
    >
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface/95 px-2.5 py-1.5 text-ink shadow-md backdrop-blur">
        <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-xs leading-5 break-words">{message}</p>
        {hasAction ? (
          <button
            type="button"
            className="shrink-0 rounded-md bg-[color:var(--color-matcha-600)] px-2 py-1 text-xs font-medium text-on-action transition-colors duration-200 hover:bg-[color:var(--color-matcha-700)]"
            onClick={onAction}
          >
            {actionLabel}
          </button>
        ) : null}
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-secondary transition-colors duration-200 hover:bg-surface-subtle"
          onClick={onDismiss}
          aria-label="ステータスメッセージを閉じる"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </output>
  );
}
