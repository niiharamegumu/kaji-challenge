import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFormPresence } from "../state/overlay";

type ConfirmModalProps = {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  children?: ReactNode;
  tone?: "default" | "warning";
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel = "キャンセル",
  confirmDisabled = false,
  children,
  tone = "default",
  onCancel,
  onConfirm,
}: ConfirmModalProps) {
  useFormPresence(isOpen);
  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[80] bg-overlay/40"
        aria-label="確認ダイアログを閉じる"
        onClick={onCancel}
      />
      <div className="fixed inset-x-0 top-1/2 z-[81] -translate-y-1/2 px-6 sm:px-8">
        <dialog
          open
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }
          }}
          className={`mx-auto w-full max-w-[calc(100vw-3rem)] rounded-xl border bg-surface p-4 shadow-lg sm:max-w-md ${tone === "warning" ? "border-warning-line" : "border-line"}`}
        >
          <div className="text-left">
            <h3 id="confirm-modal-title" className="text-base font-semibold text-heading">
              {title}
            </h3>
          </div>
          <p className="mt-3 text-left text-sm text-body">{message}</p>
          {children ? <div className="mt-3">{children}</div> : null}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              autoFocus
              className="h-9 rounded-md border border-line-strong bg-surface px-3 text-sm text-body transition-colors hover:bg-surface-muted"
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              className={`h-9 rounded-md border px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${tone === "warning" ? "border-warning-line bg-warning-soft font-semibold text-warning-strong hover:bg-warning-hover" : "border-[color:var(--color-matcha-400)] bg-[color:var(--color-matcha-50)] text-[color:var(--color-matcha-700)] hover:bg-[color:var(--color-matcha-100)]"}`}
              disabled={confirmDisabled}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </dialog>
      </div>
    </>,
    document.body,
  );
}
