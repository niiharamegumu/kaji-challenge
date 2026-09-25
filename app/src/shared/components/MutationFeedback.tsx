import { useIsMutating } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";

export function MutationFeedback() {
  const pending = useIsMutating();
  if (!pending) return null;
  return (
    <output
      className="pointer-events-none fixed bottom-40 left-1/2 z-[90] flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-stone-200 bg-white/95 px-4 py-2 text-sm text-stone-700 shadow-sm"
      aria-live="polite"
    >
      <LoaderCircle
        size={16}
        className="animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
      保存中…
    </output>
  );
}
