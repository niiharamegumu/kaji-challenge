import { AlertTriangle } from "lucide-react";
import { createPortal } from "react-dom";

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
  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-x-0 top-1/2 z-50 -translate-y-1/2 px-4">
      <dialog
        open
        aria-labelledby="delete-confirm-title"
        className="mx-auto w-full max-w-sm rounded-xl border border-stone-200 bg-white p-4 shadow-lg"
      >
        <div className="flex items-center gap-3 text-left">
          <AlertTriangle
            className="shrink-0 text-stone-900"
            size={24}
            aria-hidden="true"
          />
          <h3
            id="delete-confirm-title"
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
            className="h-9 rounded-md border border-rose-300 bg-rose-50 px-3 text-sm text-rose-700 transition-colors hover:bg-rose-100"
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
