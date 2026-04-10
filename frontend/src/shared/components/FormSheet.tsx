import type { ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  isOpen: boolean;
  title: string;
  submitLabel: string;
  submitIcon?: ReactNode;
  submitDisabled?: boolean;
  children: ReactNode;
  footerStart?: ReactNode;
  onClose: () => void;
  onSubmit: () => void;
};

export function FormSheet({
  isOpen,
  title,
  submitLabel,
  submitIcon,
  submitDisabled = false,
  children,
  footerStart,
  onClose,
  onSubmit,
}: Props) {
  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[60] bg-stone-900/20"
        aria-label={`${title}を閉じる`}
        onClick={onClose}
      />
      <dialog
        open
        className="fixed bottom-0 left-0 z-[70] w-screen rounded-t-3xl border border-stone-200 bg-white px-4 pb-[1rem)] pt-4 shadow-2xl md:bottom-4 md:left-1/2 md:w-[min(42rem,calc(100%-1rem))] md:-translate-x-1/2 md:rounded-3xl"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-stone-200" />
        <div className="mx-auto max-w-xl">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-sm text-stone-600 transition-colors hover:bg-stone-100"
              onClick={onClose}
            >
              閉じる
            </button>
          </div>
          <div className="mt-4">{children}</div>
          <div className="mt-5 flex items-center justify-between gap-3">
            <div>{footerStart}</div>
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
        </div>
      </dialog>
    </>,
    document.body,
  );
}
