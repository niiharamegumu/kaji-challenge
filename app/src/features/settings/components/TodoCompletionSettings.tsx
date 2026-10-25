import { useAtom } from "jotai";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { todoCompletionDelayAtom } from "../../../shared/state/todoCompletionDelay";
import { PAGE_SECTION_CHROMELESS_CLASS_NAME } from "../../../shared/styles/pageSection";

export function TodoCompletionSettings({ children }: { children?: ReactNode }) {
  const [delayMs, setDelayMs] = useAtom(todoCompletionDelayAtom);
  const [saveFailed, setSaveFailed] = useState(false);
  const inputId = useId();
  const descriptionId = useId();

  return (
    <article
      className={`rounded-xl px-0 py-2.5 md:rounded-2xl md:p-6 ${PAGE_SECTION_CHROMELESS_CLASS_NAME}`}
    >
      <h2 className="text-base font-semibold text-stone-900">このブラウザーの設定</h2>
      <div className="mt-3 grid min-w-0 gap-2">
        <label htmlFor={inputId} className="text-sm font-medium text-stone-700">
          ToDo完了の取り消し猶予
        </label>
        <select
          id={inputId}
          value={delayMs}
          aria-describedby={descriptionId}
          onChange={(event) => setSaveFailed(!setDelayMs(Number(event.currentTarget.value)))}
          className="h-10 min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm sm:h-11"
        >
          {[1, 2, 3, 4, 5].map((seconds) => (
            <option key={seconds} value={seconds * 1_000}>
              {seconds}秒
            </option>
          ))}
        </select>
        <div id={descriptionId} className="space-y-1 text-xs text-stone-500">
          <p>1〜5秒から選べます。初期値は3秒です。</p>
          <p>変更は自動でこのブラウザーに保存され、次に完了するToDoから適用されます。</p>
          <p>別の端末やブラウザーには引き継がれません。</p>
        </div>
        {saveFailed ? (
          <p role="alert" className="mt-2 text-xs text-red-700">
            このブラウザーに保存できませんでした。変更は適用されますが、再読み込み後は保持されません。
          </p>
        ) : null}
      </div>
      {children}
    </article>
  );
}
