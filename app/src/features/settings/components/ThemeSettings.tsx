import { useAtom } from "jotai";
import { Monitor, Moon, Sun } from "lucide-react";
import { useId, useState } from "react";
import { themePreferenceAtom } from "../../../shared/state/theme";

const options = [
  { value: "system", label: "システム", Icon: Monitor },
  { value: "dark", label: "ダーク", Icon: Moon },
  { value: "light", label: "ライト", Icon: Sun },
] as const;

export function ThemeSettings() {
  const [preference, setPreference] = useAtom(themePreferenceAtom);
  const [saveFailed, setSaveFailed] = useState(false);
  const id = useId();

  return (
    <fieldset className="mt-5 min-w-0" aria-describedby={`${id}-description`}>
      <legend className="text-sm font-medium text-body">表示モード</legend>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {options.map(({ value, label, Icon }) => (
          <label key={value} className="relative cursor-pointer">
            <input
              type="radio"
              name={id}
              value={value}
              checked={preference === value}
              onChange={() => setSaveFailed(!setPreference(value))}
              className="peer sr-only"
            />
            <span className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border border-line-strong bg-surface px-2 py-3 text-xs font-medium text-body transition-colors peer-checked:border-accent peer-checked:bg-success-soft peer-checked:text-success peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent sm:flex-row sm:text-sm">
              <Icon size={18} aria-hidden="true" />
              {label}
            </span>
          </label>
        ))}
      </div>
      <p id={`${id}-description`} className="mt-2 text-xs leading-relaxed text-muted">
        システムを選ぶと、端末の設定に合わせて自動で切り替わります。選択はこのブラウザーに保存されます。
      </p>
      {saveFailed ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          このブラウザーに保存できませんでした。変更は適用されますが、再読み込み後は保持されません。
        </p>
      ) : null}
    </fieldset>
  );
}
