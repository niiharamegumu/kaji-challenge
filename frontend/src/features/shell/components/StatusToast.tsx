import { CircleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";

type Props = {
  message: string;
  onDismiss: () => void;
};

export function StatusToast({ message, onDismiss }: Props) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressing, setIsPressing] = useState(false);

  useEffect(() => {
    if (!message || isHovered || isPressing) {
      return;
    }

    const timer = window.setTimeout(() => {
      onDismiss();
    }, 5000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isHovered, isPressing, message, onDismiss]);

  if (!message) {
    return null;
  }

  return (
    <output
      className="fixed top-4 left-1/2 z-50 w-[min(92vw,36rem)] -translate-x-1/2"
      aria-live="polite"
      data-testid="status-message"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onPointerDown={() => setIsPressing(true)}
      onPointerUp={() => setIsPressing(false)}
      onPointerCancel={() => setIsPressing(false)}
      onPointerLeave={() => setIsPressing(false)}
    >
      <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white/95 p-3 text-stone-800 shadow-lg backdrop-blur">
        <CircleAlert size={18} className="shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm leading-6 break-words">
          {message}
        </p>
        <button
          type="button"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-stone-200 text-stone-600 transition-colors duration-200 hover:bg-stone-50"
          onClick={onDismiss}
          aria-label="ステータスメッセージを閉じる"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </output>
  );
}
