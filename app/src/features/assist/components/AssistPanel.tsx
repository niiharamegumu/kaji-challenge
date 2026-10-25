import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, AudioLines, LoaderCircle, Mic, Square, X } from "lucide-react";
import type { VoiceSession, VoiceState } from "../model/VoiceSession";
import { assistLimits } from "../../../contracts/assist";
import "./assist.css";
import { AssistHelp } from "./AssistHelp";

const labels: Record<VoiceState["phase"], string> = {
  closed: "終了しました",
  idle: "入力するか、マイクをタップ",
  starting: "マイクを準備しています",
  listening: "録音中",
  recording: "録音中",
  transcribing: "文字にしています",
  reviewing: "内容を確認して送信",
  processing: "考えています",
  done: "続けて入力できます",
  error: "入力を確認してください",
};
const bars = [6, 12, 22, 16, 28, 20, 34, 24, 14, 26, 18, 10, 6];

function fitInput(input: HTMLTextAreaElement | null) {
  if (!input || input.hidden) return;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 148)}px`;
}

function RecordingTime() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span>
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

export function AssistPanel({ session, state }: { session: VoiceSession; state: VoiceState }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const recording = state.phase === "listening" || state.phase === "recording";
  const busy = ["starting", "transcribing", "processing"].includes(state.phase);
  const tooLong = state.transcript.length > assistLimits.transcript;
  useLayoutEffect(() => {
    fitInput(input.current);
  }, [state.open, state.transcript, state.phase]);
  useEffect(() => {
    if (state.phase === "reviewing") dialog.current?.querySelector("textarea")?.focus();
  }, [state.phase]);
  useEffect(() => {
    const element = dialog.current;
    if (!element || !state.open) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    element.showModal();
    // Keep the composer above the software keyboard, including iOS visual viewport changes.
    const viewport = window.visualViewport;
    const resize = () => {
      element.style.setProperty("--assist-height", `${viewport?.height ?? window.innerHeight}px`);
      element.style.setProperty("--assist-top", `${viewport?.offsetTop ?? 0}px`);
      fitInput(input.current);
    };
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
      window.removeEventListener("resize", resize);
      element.close();
      document.documentElement.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [state.open]);
  if (!state.open || typeof document === "undefined") return null;
  const result = state.result;
  const replies = result?.kind === "batch" ? result.results : result ? [result] : [];
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
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), textarea:not([hidden]), [tabindex="0"]',
          ),
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
    >
      <header className="assist-header">
        <span className="assist-brand">
          <AudioLines size={20} strokeWidth={1.8} aria-hidden="true" />
          アシスト
        </span>
        <div className="assist-header-actions">
          <AssistHelp />
          <button
            type="button"
            className="assist-icon-button assist-close"
            onClick={session.close}
            aria-label="アシストを閉じる"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
      </header>
      <section className="assist-thread" aria-label="会話">
        {!state.submittedTranscript ? (
          <div className="assist-welcome">
            <span className="assist-mark" aria-hidden="true">
              <AudioLines size={26} strokeWidth={1.7} />
            </span>
            <h1>何を追加しますか？</h1>
            <p>話しても、入力しても。</p>
          </div>
        ) : (
          <div className="assist-messages">
            <p className="assist-user-message">{state.submittedTranscript}</p>
            {result ? (
              <div className="assist-answer" aria-live="polite">
                {replies.map((reply, index) => (
                  <div className="assist-answer-part" key={index}>
                    <p>{reply.replyText}</p>
                    {reply.kind === "listed" && reply.items.length > 0 ? (
                      <div
                        className="assist-results"
                        aria-label={`ToDo ${reply.total}件`}
                        tabIndex={0}
                      >
                        {reply.total > reply.items.length ? (
                          <p className="assist-more">
                            全{reply.total}件のうち先頭{reply.items.length}
                            件を表示しています。続きはToDo画面で確認してください。
                          </p>
                        ) : null}
                        <ul>
                          {reply.items.map((item) => (
                            <li key={item.id}>{item.name}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : state.phase === "processing" ? (
              <div className="assist-thinking" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
            ) : null}
          </div>
        )}
      </section>
      <div className="assist-input-area">
        {state.message ? (
          <p role="alert" className="assist-error">
            {state.message}
          </p>
        ) : null}
        <p role="status" aria-live="polite" className="assist-sr-only">
          {labels[state.phase]}
        </p>
        <form
          className="assist-composer"
          onSubmit={(event) => {
            event.preventDefault();
            session.send();
          }}
          aria-busy={busy}
        >
          <label htmlFor="assist-transcript" className="assist-sr-only">
            送信する内容
          </label>
          <textarea
            ref={input}
            id="assist-transcript"
            hidden={recording || state.phase === "starting" || state.phase === "transcribing"}
            value={state.transcript}
            maxLength={assistLimits.transcript}
            rows={2}
            readOnly={busy}
            aria-invalid={tooLong}
            placeholder="買い物や、やることを入力"
            onChange={(event) => session.editTranscript(event.target.value)}
          />
          {state.phase === "transcribing" ? (
            <div className="assist-transcribing" aria-hidden="true">
              <span className="assist-spinner">
                <LoaderCircle size={28} strokeWidth={1.8} />
              </span>
            </div>
          ) : null}
          {recording || state.phase === "starting" ? (
            <div className="assist-recording" aria-hidden="true">
              <div className="assist-wave">
                {bars.map((height, index) => (
                  <i key={index} style={{ height, animationDelay: `${index * -95}ms` }} />
                ))}
              </div>
              {recording ? <RecordingTime /> : <span>準備中</span>}
            </div>
          ) : null}
          <div className="assist-toolbar">
            <button
              type="button"
              className={`assist-icon-button ${recording ? "assist-stop" : ""}`}
              disabled={busy}
              onClick={() => (recording ? session.stopRecording() : session.startRecording())}
              aria-label={recording ? "録音を停止" : "録音を開始"}
              title={recording ? "停止して入力欄に反映" : "音声で入力"}
            >
              {recording ? (
                <Square size={17} fill="currentColor" aria-hidden="true" />
              ) : (
                <Mic size={21} strokeWidth={1.8} aria-hidden="true" />
              )}
            </button>
            <div aria-hidden="true" className="assist-state">
              {busy ? null : labels[state.phase]}
              {state.phase === "starting" ? (
                <span className="assist-spinner" aria-hidden="true">
                  <LoaderCircle size={20} strokeWidth={1.8} />
                </span>
              ) : null}
            </div>
            <button
              type={recording ? "button" : "submit"}
              className={`assist-send ${recording ? "assist-send-recording" : ""}`}
              disabled={busy || (!recording && (!state.transcript.trim() || tooLong))}
              onClick={recording ? () => session.stopRecording(true) : undefined}
              aria-label={recording ? "停止して送信" : "送信"}
              title={recording ? "停止して送信" : "送信"}
            >
              {recording ? <span>停止して送信</span> : null}
              <ArrowUp size={20} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </form>
        <p id="assist-privacy" className="assist-privacy">
          音声は文字起こしのために送信されます
        </p>
      </div>
    </dialog>,
    document.body,
  );
}
