import { useAtom } from "jotai";
import { useId, useState } from "react";
import {
  MAX_TODO_COMPLETION_DELAY_MS,
  MIN_TODO_COMPLETION_DELAY_MS,
  TODO_COMPLETION_DELAY_STEP_MS,
  todoCompletionDelayAtom,
} from "../../../shared/state/todoCompletionDelay";
import { PAGE_SECTION_CHROMELESS_CLASS_NAME } from "../../../shared/styles/pageSection";

export function TodoCompletionSettings() {
  const [delayMs, setDelayMs] = useAtom(todoCompletionDelayAtom);
  const [saveFailed, setSaveFailed] = useState(false);
  const inputId = useId();
  const descriptionId = useId();
  const seconds = (delayMs / 1_000).toFixed(1);

  return (
    <article
      className={`rounded-xl px-0 py-2.5 md:rounded-2xl md:p-6 ${PAGE_SECTION_CHROMELESS_CLASS_NAME}`}
    >
      <h2 className="text-base font-semibold text-stone-900">このブラウザーの設定</h2>
      <div className="mt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={inputId} className="text-sm font-medium text-stone-700">
            ToDo完了の取り消し猶予
          </label>
          <output htmlFor={inputId} className="text-sm font-semibold tabular-nums text-stone-900">
            {seconds}秒
          </output>
        </div>
        <input
          id={inputId}
          type="range"
          min={MIN_TODO_COMPLETION_DELAY_MS}
          max={MAX_TODO_COMPLETION_DELAY_MS}
          step={TODO_COMPLETION_DELAY_STEP_MS}
          value={delayMs}
          aria-valuetext={`${seconds}秒`}
          aria-describedby={descriptionId}
          onChange={(event) => setSaveFailed(!setDelayMs(event.currentTarget.valueAsNumber))}
          className="mt-2 h-11 w-full cursor-pointer accent-[color:var(--color-matcha-600)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500"
        />
        <div id={descriptionId} className="space-y-1 text-xs text-stone-500">
          <p>0.1〜5.0秒の間で、0.1秒刻みに変更できます。初期値は3.0秒です。</p>
          <p>変更は自動でこのブラウザーに保存され、次に完了するToDoから適用されます。</p>
          <p>別の端末やブラウザーには引き継がれません。</p>
        </div>
        {saveFailed ? (
          <p role="alert" className="mt-2 text-xs text-red-700">
            このブラウザーに保存できませんでした。変更は適用されますが、再読み込み後は保持されません。
          </p>
        ) : null}
      </div>
    </article>
  );
}
