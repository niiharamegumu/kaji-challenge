import { useId } from "react";
import { InfoHelp } from "../../../shared/components/InfoHelp";
import { useUserPreferences } from "../../../shared/state/userPreferences";

export function TodoCompletionSettings() {
  const { preferences, writable, update } = useUserPreferences();
  const delayMs = preferences.todoCompletionDelayMs;
  const inputId = useId();

  return (
    <section>
      <div className="grid min-w-0 gap-2">
        <div className="flex items-center gap-1">
          <label htmlFor={inputId} className="text-sm font-medium text-body">
            ToDo完了の取り消し猶予
          </label>
          <InfoHelp label="取り消し猶予の説明">
            <p>1〜5秒から選べます。初期値は3秒です。</p>
            <p>変更はアカウントに自動保存され、次に完了するToDoから適用されます。</p>
            <p>同じユーザーでログインした別の端末やブラウザーでも使えます。</p>
          </InfoHelp>
        </div>
        <select
          id={inputId}
          value={delayMs}
          disabled={!writable}
          onChange={(event) =>
            update({ todoCompletionDelayMs: Number(event.currentTarget.value) as typeof delayMs })
          }
          className="min-h-11 min-w-0 rounded-lg border border-line-strong bg-surface px-3 py-2 text-base sm:text-sm"
        >
          {[1, 2, 3, 4, 5].map((seconds) => (
            <option key={seconds} value={seconds * 1_000}>
              {seconds}秒
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
