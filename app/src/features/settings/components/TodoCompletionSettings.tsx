import { useAtom } from "jotai";
import { useId, useState } from "react";
import { todoCompletionDelayAtom } from "../../../shared/state/todoCompletionDelay";

export function TodoCompletionSettings() {
  const [delayMs, setDelayMs] = useAtom(todoCompletionDelayAtom);
  const [saveFailed, setSaveFailed] = useState(false);
  const inputId = useId();
  const descriptionId = useId();

  return (
    <section>
      <div className="grid min-w-0 gap-2">
        <label htmlFor={inputId} className="text-sm font-medium text-body">
          ToDo完了の取り消し猶予
        </label>
        <select
          id={inputId}
          value={delayMs}
          aria-describedby={descriptionId}
          onChange={(event) => setSaveFailed(!setDelayMs(Number(event.currentTarget.value)))}
          className="min-h-11 min-w-0 rounded-lg border border-line-strong bg-surface px-3 py-2 text-base sm:text-sm"
        >
          {[1, 2, 3, 4, 5].map((seconds) => (
            <option key={seconds} value={seconds * 1_000}>
              {seconds}秒
            </option>
          ))}
        </select>
        <div id={descriptionId} className="space-y-1 text-xs text-muted">
          <p>1〜5秒から選べます。初期値は3秒です。</p>
          <p>変更は自動でこのブラウザーに保存され、次に完了するToDoから適用されます。</p>
          <p>別の端末やブラウザーには引き継がれません。</p>
        </div>
        {saveFailed ? (
          <p role="alert" className="mt-2 text-xs text-danger">
            このブラウザーに保存できませんでした。変更は適用されますが、再読み込み後は保持されません。
          </p>
        ) : null}
      </div>
    </section>
  );
}
