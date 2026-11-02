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
  footerStart?: ReactNode;
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
  footerStart,
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
        footerStart={footerStart}
        onClose={onClose}
        onSubmit={onSubmit}
      >
        {children}
      </FormSheet>

      <button
        type="button"
        className="fixed bottom-[92px] left-1/2 z-[49] inline-flex h-12 w-12 -translate-x-1/2 items-center justify-center overflow-hidden rounded-full border border-glass-edge/34 bg-[image:var(--glass-panel)] text-heading shadow-glass transition-transform duration-200 hover:scale-[1.02] focus-visible:outline-none"
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
            background: "var(--glass-decoration)",
          }}
        />
        <span className="pointer-events-none absolute inset-y-2 left-0 w-px bg-overlay/10 blur-[1px]" />
        <span className="pointer-events-none absolute inset-y-2 right-0 w-px bg-overlay/8 blur-[1px]" />
        <span className="pointer-events-none absolute left-1/2 top-1.5 h-3 w-7 -translate-x-1/2 rounded-full bg-surface/18 blur-md" />
        <span className="relative block h-4 w-4" aria-hidden="true">
          <span className="absolute left-1/2 top-1/2 h-0.5 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
          <span className="absolute left-1/2 top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
        </span>
      </button>
    </>,
    document.body,
  );
}
