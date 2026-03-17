import { createPortal } from "react-dom";

type ConfirmModalProps = {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
}: ConfirmModalProps) {
  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-x-0 top-1/2 z-50 -translate-y-1/2 px-6 sm:px-8">
      <dialog
        open
        aria-labelledby="confirm-modal-title"
        className="mx-auto w-full max-w-[calc(100vw-3rem)] rounded-xl border border-stone-200 bg-white p-4 shadow-lg sm:max-w-md"
      >
        <div className="text-left">
          <h3
            id="confirm-modal-title"
            className="text-base font-semibold text-stone-900"
          >
            {title}
          </h3>
        </div>
        <p className="mt-3 text-left text-sm text-stone-700">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="h-9 rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-700 transition-colors hover:bg-stone-100"
            onClick={onCancel}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="h-9 rounded-md border border-[color:var(--color-matcha-400)] bg-[color:var(--color-matcha-50)] px-3 text-sm text-[color:var(--color-matcha-700)] transition-colors hover:bg-[color:var(--color-matcha-100)]"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </dialog>
    </div>,
    document.body,
  );
}
