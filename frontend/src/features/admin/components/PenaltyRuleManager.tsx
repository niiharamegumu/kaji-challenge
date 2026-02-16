import type { ChangeEvent } from "react";

import type { PenaltyRule } from "../../../lib/api/generated/client";
import type { RuleFormState } from "../state/forms";

type Props = {
  form: RuleFormState;
  rules: PenaltyRule[];
  onFormChange: (updater: (prev: RuleFormState) => RuleFormState) => void;
  onCreate: () => void;
  onToggle: (rule: PenaltyRule) => void;
  onDelete: (ruleId: string) => void;
};

export function PenaltyRuleManager({
  form,
  rules,
  onFormChange,
  onCreate,
  onToggle,
  onDelete,
}: Props) {
  const handleChange =
    (key: keyof RuleFormState) => (event: ChangeEvent<HTMLInputElement>) => {
      onFormChange((prev) => ({ ...prev, [key]: event.target.value }));
    };

  return (
    <article className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm animate-enter">
      <h2 className="text-lg font-semibold">ペナルティ管理</h2>
      <div className="mt-3 grid gap-2">
        <label className="text-sm text-stone-700" htmlFor="rule-name">
          ルール名
        </label>
        <input
          id="rule-name"
          className="rounded-lg border border-stone-300 px-3 py-2"
          value={form.name}
          onChange={handleChange("name")}
          placeholder="ルール名"
        />
        <label className="text-sm text-stone-700" htmlFor="rule-threshold">
          発動しきい値
        </label>
        <input
          id="rule-threshold"
          className="rounded-lg border border-stone-300 px-3 py-2"
          type="number"
          min={1}
          value={form.threshold}
          onChange={handleChange("threshold")}
          placeholder="閾値"
        />
        <button
          type="button"
          className="rounded-lg bg-stone-900 px-3 py-2 text-white"
          onClick={onCreate}
        >
          ルール追加
        </button>
      </div>
      <ul className="mt-4 space-y-2">
        {rules.map((rule) => (
          <li key={rule.id} className="rounded-xl border border-stone-300 p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{rule.name}</div>
                <div className="text-xs text-stone-600">
                  発動しきい値 {rule.threshold} /{" "}
                  {rule.isActive ? "有効" : "無効"}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-stone-300 px-2 py-1 text-xs"
                  onClick={() => onToggle(rule)}
                >
                  {rule.isActive ? "無効化" : "有効化"}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-rose-300 px-2 py-1 text-xs text-rose-700"
                  onClick={() => onDelete(rule.id)}
                >
                  削除
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </article>
  );
}
