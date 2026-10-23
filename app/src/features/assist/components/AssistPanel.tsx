import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { VoiceSession, VoiceState } from "../model/VoiceSession";
import { useLocalVoice } from "../hooks/useLocalVoice";
import "./assist.css";

const labels: Record<VoiceState["phase"], string> = {
  closed: "終了しました",
  starting: "準備しています",
  listening: "話しかけてください",
  recording: "聞いています",
  processing: "考えています",
  speaking: "お返事しています",
  error: "音声を終了しました",
};

export function AssistPanel({ session, state }: { session: VoiceSession; state: VoiceState }) {
  // Warm the device's voice list before the first gesture, without exposing settings.
  useLocalVoice();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element || !state.open) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    element.showModal();
    return () => {
      element.close();
      document.documentElement.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [state.open]);
  if (!state.open || typeof document === "undefined") return null;
  const result = state.result;
  return createPortal(
    <dialog
      ref={dialog}
      aria-label="音声アシスト"
      aria-describedby="assist-privacy"
      className="assist-mode"
      data-phase={state.phase}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>('button, [tabindex="0"]'),
        );
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        session.close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) session.close();
      }}
    >
      <div className="assist-conversation">
        <div className="assist-orb" aria-hidden="true">
          <span className="assist-orb-light" />
          <span className="assist-orb-core" />
          <span className="assist-wave">
            {[0, 1, 2, 3, 4].map((bar) => (
              <i key={bar} />
            ))}
          </span>
        </div>
        <p role="status" aria-live="polite" className="assist-state">
          {labels[state.phase]}
        </p>
        <div className="assist-words">
          {result ? (
            <>
              <p className="assist-transcript">{result.transcript}</p>
              <p className="assist-reply">{result.replyText}</p>
              {result.kind === "listed" && result.items.length > 0 ? (
                <div className="assist-results" aria-label={`ToDo ${result.total}件`} tabIndex={0}>
                  <ul>
                    {result.items.map((item) => (
                      <li key={item.id}>{item.name}</li>
                    ))}
                  </ul>
                  {result.total > result.items.length ? (
                    <p className="mt-3 text-xs text-stone-600">続きはToDo画面で確認できます</p>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : !state.message ? (
            <p className="assist-example">「買い物に牛乳を追加して」</p>
          ) : null}
          {state.message ? (
            <p role="alert" className="assist-error">
              {state.message}
            </p>
          ) : null}
        </div>
      </div>
      <div className="assist-exit">
        <button
          type="button"
          onClick={session.close}
          aria-label="アシストを閉じる"
          className="assist-close"
        >
          <X size={23} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <p id="assist-privacy">音声は認識のために送信されます</p>
      </div>
    </dialog>,
    document.body,
  );
}
