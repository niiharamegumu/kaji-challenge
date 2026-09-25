import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { createPortal } from "react-dom";

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
  onSubmit: () => void | Promise<void>;
};

export function FormSheet({
  isOpen,
  title,
  submitLabel,
  submitIcon,
  submitDisabled = false,
  isSubmitting,
  submitFailed = false,
  children,
  footerStart,
  onClose,
  onSubmit,
}: Props) {
  const submit = async () => {
    if (isSubmitting || submitDisabled) return;
    try {
      await onSubmit();
    } catch {
      // 通信状態・エラーは呼出元のmutationが管理する。入力は成功するまで保持する。
    }
  };
  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[72] bg-stone-500/18 backdrop-blur-[4px]"
        aria-label={`${title}を閉じる`}
        onClick={onClose}
        disabled={isSubmitting}
      />
      <dialog
        open
        className="fixed bottom-[94px] left-1/2 z-[73] flex max-h-[calc(100dvh-110px-env(safe-area-inset-top))] w-[min(92vw,30rem)] -translate-x-1/2 flex-col overflow-hidden rounded-[1.8rem] border border-white/40 bg-[linear-gradient(180deg,rgba(255,255,255,0.56),rgba(246,241,232,0.36))] p-4 shadow-[0_24px_48px_-30px_rgba(68,56,36,0.42),inset_0_1px_0_rgba(255,255,255,0.62)]"
        style={{
          backdropFilter: "blur(26px) saturate(180%)",
          WebkitBackdropFilter: "blur(26px) saturate(180%)",
        }}
        aria-modal="true"
        aria-label={title}
      >
        <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-white/85" />
        <div className="pointer-events-none absolute inset-x-8 top-2 h-8 rounded-full bg-white/20 blur-xl" />
        <div className="mx-auto mb-4 h-1.5 w-12 shrink-0 rounded-full bg-white/55" />
        <div className="flex shrink-0 items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-stone-900">{title}</h2>
          <button
            type="button"
            className="rounded-full px-3 py-1.5 text-sm text-stone-600 transition-colors hover:bg-white/45"
            onClick={onClose}
            disabled={isSubmitting}
          >
            閉じる
          </button>
        </div>
        <fieldset disabled={isSubmitting} className="mt-4 min-h-0 overflow-y-auto">
          {children}
        </fieldset>
        {submitFailed && !isSubmitting ? (
          <p role="alert" className="mt-2 text-sm text-rose-700">
            保存できませんでした。もう一度お試しください。
          </p>
        ) : null}
        <div className="mt-5 flex shrink-0 items-center justify-between gap-3">
          <fieldset disabled={isSubmitting}>{footerStart}</fieldset>
          <button
            type="button"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-stone-900 px-4 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              void submit();
            }}
            disabled={submitDisabled || isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <LoaderCircle
                size={16}
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              submitIcon
            )}
            <span>{isSubmitting ? "保存中…" : submitLabel}</span>
          </button>
        </div>
      </dialog>
    </>,
    document.body,
  );
}
