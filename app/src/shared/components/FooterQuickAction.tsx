import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { FormSheet } from "./FormSheet";

type Props = {
  isOpen: boolean;
  title: string;
  submitLabel: string;
  submitIcon?: ReactNode;
  submitDisabled?: boolean;
  isSubmitting: boolean;
  submitFailed?: boolean;
  children: ReactNode;
  onClose: () => void;
  onOpen: () => void;
  onSubmit: () => void | Promise<void>;
};

export function FooterQuickAction({
  isOpen,
  title,
  submitLabel,
  submitIcon,
  submitDisabled = false,
  isSubmitting,
  submitFailed,
  children,
  onClose,
  onOpen,
  onSubmit,
}: Props) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <>
      <FormSheet
        isOpen={isOpen}
        title={title}
        submitLabel={submitLabel}
        submitIcon={submitIcon}
        submitDisabled={submitDisabled}
        isSubmitting={isSubmitting}
        submitFailed={submitFailed}
        onClose={onClose}
        onSubmit={onSubmit}
      >
        {children}
      </FormSheet>

      <button
        type="button"
        className="fixed bottom-[92px] left-1/2 z-[49] inline-flex h-12 w-12 -translate-x-1/2 items-center justify-center overflow-hidden rounded-full border border-white/34 bg-[linear-gradient(180deg,rgba(244,242,238,0.54),rgba(224,220,214,0.24))] text-stone-900 shadow-[0_14px_24px_-18px_rgba(68,56,36,0.38),0_8px_20px_-16px_rgba(34,29,21,0.18),inset_0_1px_0_rgba(255,255,255,0.72),inset_0_0_0_1px_rgba(158,150,138,0.12)] transition-transform duration-200 hover:scale-[1.02] focus-visible:outline-none"
        style={{
          backdropFilter: "blur(26px) saturate(220%) brightness(0.94) contrast(1.08)",
          WebkitBackdropFilter: "blur(26px) saturate(220%) brightness(0.94) contrast(1.08)",
        }}
        onClick={isOpen ? onClose : onOpen}
        disabled={isSubmitting}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label="追加"
      >
        <span
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              "radial-gradient(120% 92% at 50% -18%, rgba(255,255,255,0.34), rgba(255,255,255,0) 48%), radial-gradient(120% 100% at 50% 120%, rgba(176,184,204,0.14), rgba(255,255,255,0) 54%), linear-gradient(90deg, rgba(214,224,255,0.08), rgba(255,255,255,0) 18%, rgba(255,255,255,0) 82%, rgba(255,215,190,0.08))",
          }}
        />
        <span className="pointer-events-none absolute inset-y-2 left-0 w-px bg-stone-500/10 blur-[1px]" />
        <span className="pointer-events-none absolute inset-y-2 right-0 w-px bg-stone-500/8 blur-[1px]" />
        <span className="pointer-events-none absolute left-1/2 top-1.5 h-3 w-7 -translate-x-1/2 rounded-full bg-white/18 blur-md" />
        <span className="relative block h-4 w-4" aria-hidden="true">
          <span className="absolute left-1/2 top-1/2 h-0.5 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
          <span className="absolute left-1/2 top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
        </span>
      </button>
    </>,
    document.body,
  );
}
