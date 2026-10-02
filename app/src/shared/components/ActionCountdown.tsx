import { useEffect, useState } from "react";
import { DELAYED_ACTION_MS } from "../state/DelayedActionProvider";

const circumference = 2 * Math.PI * 9;

export function ActionCountdown({
  deadline,
  label = "完了まで",
}: {
  deadline: number;
  label?: string;
}) {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, deadline - Date.now()));

  useEffect(() => {
    const timer = setInterval(() => {
      setRemainingMs(Math.max(0, deadline - Date.now()));
    }, 100);
    return () => clearInterval(timer);
  }, [deadline]);

  const seconds = Math.max(1, Math.ceil(remainingMs / 1_000));
  const progress = Math.min(1, remainingMs / DELAYED_ACTION_MS);

  return (
    <span
      role="img"
      aria-label={`${label}${seconds}秒`}
      className="relative inline-flex size-5 shrink-0 items-center justify-center"
    >
      <svg viewBox="0 0 24 24" className="absolute inset-0 size-full" aria-hidden="true">
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.2"
        />
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          transform="rotate(-90 12 12)"
          className="transition-[stroke-dashoffset] duration-100 ease-linear motion-reduce:transition-none"
        />
      </svg>
      <span aria-hidden="true" className="text-[10px] font-semibold leading-none tabular-nums">
        {seconds}
      </span>
    </span>
  );
}
