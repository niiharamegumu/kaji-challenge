import type { ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  isOpen: boolean;
  title: string;
  submitLabel: string;
  submitIcon?: ReactNode;
  submitDisabled?: boolean;
  children: ReactNode;
  onClose: () => void;
  onOpen: () => void;
  onSubmit: () => void;
};

export function FooterQuickAction({
  isOpen,
  title,
  submitLabel,
  submitIcon,
  submitDisabled = false,
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
      {isOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-[60] bg-stone-500/18 backdrop-blur-[4px]"
          aria-label={`${title}を閉じる`}
          onClick={onClose}
        />
      ) : null}

      {isOpen ? (
        <dialog
          open
          className="fixed bottom-[94px] left-1/2 z-[70] w-[min(92vw,30rem)] -translate-x-1/2 overflow-hidden rounded-[1.8rem] border border-white/40 bg-[linear-gradient(180deg,rgba(255,255,255,0.56),rgba(246,241,232,0.36))] p-4 shadow-[0_24px_48px_-30px_rgba(68,56,36,0.42),inset_0_1px_0_rgba(255,255,255,0.62)]"
          style={{
            backdropFilter: "blur(26px) saturate(180%)",
            WebkitBackdropFilter: "blur(26px) saturate(180%)",
          }}
          aria-modal="true"
          aria-label={title}
        >
          <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-white/85" />
          <div className="pointer-events-none absolute inset-x-8 top-2 h-8 rounded-full bg-white/20 blur-xl" />
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/55" />
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-stone-900">{title}</h2>
            <button
              type="button"
              className="rounded-full px-3 py-1.5 text-sm text-stone-600 transition-colors hover:bg-white/45"
              onClick={onClose}
            >
              閉じる
            </button>
          </div>
          <div className="mt-4">{children}</div>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-stone-900 px-4 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={onSubmit}
              disabled={submitDisabled}
            >
              {submitIcon}
              <span>{submitLabel}</span>
            </button>
          </div>
        </dialog>
      ) : null}

      <button
        type="button"
        className="fixed bottom-[92px] left-1/2 z-[49] inline-flex h-12 w-12 -translate-x-1/2 items-center justify-center overflow-hidden rounded-full border border-white/34 bg-[linear-gradient(180deg,rgba(244,242,238,0.54),rgba(224,220,214,0.24))] text-stone-900 shadow-[0_14px_24px_-18px_rgba(68,56,36,0.38),0_8px_20px_-16px_rgba(34,29,21,0.18),inset_0_1px_0_rgba(255,255,255,0.72),inset_0_0_0_1px_rgba(158,150,138,0.12)] transition-transform duration-200 hover:scale-[1.02] focus-visible:outline-none"
        style={{
          backdropFilter:
            "blur(26px) saturate(220%) brightness(0.94) contrast(1.08)",
          WebkitBackdropFilter:
            "blur(26px) saturate(220%) brightness(0.94) contrast(1.08)",
        }}
        onClick={isOpen ? onClose : onOpen}
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
