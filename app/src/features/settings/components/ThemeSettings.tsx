import { useAtom } from "jotai";
import { Monitor, Moon, Sun } from "lucide-react";
import { useId, useState } from "react";
import { InfoHelp } from "../../../shared/components/InfoHelp";
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
    <fieldset className="min-w-0" aria-labelledby={`${id}-label`}>
      <legend className="text-sm font-medium text-body">
        <span className="inline-flex items-center gap-1">
          <span id={`${id}-label`}>表示モード</span>
          <InfoHelp label="表示モードの説明">
            システムを選ぶと、端末の設定に合わせて自動で切り替わります。選択はこのブラウザーに保存されます。
          </InfoHelp>
        </span>
      </legend>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
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
            <span className="flex flex-col gap-3 rounded-xl border border-line-strong bg-surface p-2 text-xs font-medium text-body transition-colors peer-checked:border-accent peer-checked:bg-success-soft peer-checked:text-success sm:p-3 sm:text-sm">
              <span
                aria-hidden="true"
                className={`flex h-16 overflow-hidden rounded-md border border-black/10 sm:h-24 ${value === "dark" ? "bg-[#202822]" : value === "light" ? "bg-[#fafbf7]" : "bg-linear-to-r from-[#fafbf7] from-50% to-[#202822] to-50%"}`}
              >
                <span
                  className={`w-1/4 border-r ${value === "dark" ? "border-white/10 bg-white/5" : "border-black/5 bg-black/5"}`}
                />
                <span className="flex flex-1 flex-col gap-2 p-2 sm:p-3">
                  <span className="h-2 w-3/4 rounded-full bg-[#8ba17c]" />
                  <span
                    className={`h-2 rounded-full ${value === "dark" ? "bg-white/20" : "bg-[#b3bcb0]"}`}
                  />
                  <span className="h-2 w-2/3 rounded-full bg-[#8ba17c]/40" />
                </span>
              </span>
              <span className="flex items-center justify-center gap-1.5">
                <Icon size={16} aria-hidden="true" />
                {label}
              </span>
            </span>
          </label>
        ))}
      </div>
      {saveFailed ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          このブラウザーに保存できませんでした。変更は適用されますが、再読み込み後は保持されません。
        </p>
      ) : null}
    </fieldset>
  );
}
