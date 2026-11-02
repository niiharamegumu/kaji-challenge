import { AlertTriangle } from "lucide-react";
import { createPortal } from "react-dom";
import { useFormPresence } from "../state/overlay";

type DeleteConfirmModalProps = {
  isOpen: boolean;
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteConfirmModal({
  isOpen,
  title,
  message,
  onCancel,
  onConfirm,
}: DeleteConfirmModalProps) {
  useFormPresence(isOpen);
  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-x-0 top-1/2 z-50 -translate-y-1/2 px-4">
      <dialog
        open
        aria-labelledby="delete-confirm-title"
        className="mx-auto w-full max-w-sm rounded-xl border border-line bg-surface p-4 shadow-lg"
      >
        <div className="flex items-center gap-3 text-left">
          <AlertTriangle className="shrink-0 text-heading" size={24} aria-hidden="true" />
          <h3 id="delete-confirm-title" className="text-base font-semibold text-heading">
            {title}
          </h3>
        </div>
        <p className="mt-3 text-left text-sm text-body">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="h-9 rounded-md border border-line-strong bg-surface px-3 text-sm text-body transition-colors hover:bg-surface-muted"
            onClick={onCancel}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="h-9 rounded-md border border-danger-line bg-danger-soft px-3 text-sm text-danger transition-colors hover:bg-danger-hover"
            onClick={onConfirm}
          >
            削除する
          </button>
        </div>
      </dialog>
    </div>,
    document.body,
  );
}
