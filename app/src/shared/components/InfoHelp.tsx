import { Info, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function InfoHelp({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [open]);

  function close() {
    dialog.current?.close();
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="-my-1.5 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-surface-muted hover:text-heading"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Info size={17} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            aria-labelledby={id}
            className="fixed inset-0 m-auto max-h-[80dvh] w-[min(24rem,92vw)] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface p-0 text-body shadow-lg backdrop:bg-overlay/40"
            onClick={(event) => {
              event.stopPropagation();
              if (event.target === event.currentTarget) close();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" || event.key === "Tab") event.stopPropagation();
            }}
            onCancel={(event) => {
              event.preventDefault();
              event.stopPropagation();
              close();
            }}
          >
            <div className="px-4 pb-4">
              <header className="sticky top-0 flex items-center justify-between gap-2 bg-surface pt-2">
                <h2 id={id} className="text-base font-semibold text-heading">
                  {label}
                </h2>
                <button
                  type="button"
                  aria-label="閉じる"
                  onClick={close}
                  className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-secondary hover:bg-surface-muted"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </header>
              <div className="space-y-2 break-words text-sm leading-6">{children}</div>
            </div>
          </dialog>,
          document.body,
        )}
    </>
  );
}
