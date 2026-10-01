import { useIsMutating } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";

export function MutationFeedback() {
  const pending = useIsMutating();
  if (!pending) return null;
  return (
    <output
      className="app-glass-surface pointer-events-none fixed bottom-40 left-1/2 z-[90] flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-white/40 text-stone-700"
      aria-label="保存中"
      aria-live="polite"
    >
      <LoaderCircle
        size={16}
        className="animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
    </output>
  );
}
