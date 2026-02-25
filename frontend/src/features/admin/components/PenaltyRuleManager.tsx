import { CirclePlus, Trash2 } from "lucide-react";
import type { ChangeEvent } from "react";
import { useMemo } from "react";

import type { PenaltyRule } from "../../../lib/api/generated/client";
import type { RuleFormState } from "../state/forms";

type Props = {
  form: RuleFormState;
  rules: PenaltyRule[];
  onFormChange: (updater: (prev: RuleFormState) => RuleFormState) => void;
  onCreate: () => void;
  onDelete: (ruleId: string) => void;
};

export function PenaltyRuleManager({
  form,
  rules,
  onFormChange,
  onCreate,
  onDelete,
}: Props) {
  const handleChange =
    (key: keyof RuleFormState) => (event: ChangeEvent<HTMLInputElement>) => {
      onFormChange((prev) => ({ ...prev, [key]: event.target.value }));
    };

  const sortedRules = useMemo(
    () => [...rules].sort((a, b) => b.threshold - a.threshold),
    [rules],
  );

  return (
    <article className="animate-enter rounded-xl border border-stone-200 bg-white/90 p-3 shadow-sm md:rounded-2xl md:p-6">
      <h2 className="text-lg font-semibold">ペナルティ管理</h2>
      <div className="mt-4 grid gap-3">
        <label className="text-sm text-stone-700" htmlFor="rule-name">
          ルール名
        </label>
        <input
          id="rule-name"
          className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 py-2"
          value={form.name}
          onChange={handleChange("name")}
          placeholder="ルール名"
        />
        <label className="text-sm text-stone-700" htmlFor="rule-threshold">
          発動しきい値
        </label>
        <input
          id="rule-threshold"
          className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 py-2"
          type="number"
          min={1}
          value={form.threshold}
          onChange={handleChange("threshold")}
          placeholder="閾値"
        />
        <div className="mt-1 flex justify-start">
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-white transition-colors duration-200 hover:bg-stone-800 sm:w-auto sm:min-w-44"
            onClick={onCreate}
          >
            <CirclePlus size={16} aria-hidden="true" />
            <span>ルール追加</span>
          </button>
        </div>
      </div>
      <div className="mt-6 border-t border-stone-200 pt-5">
        {sortedRules.length === 0 ? (
          <p className="text-sm text-stone-500">
            ペナルティルールはまだありません。
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sortedRules.map((rule) => (
              <li
                key={rule.id}
                className="rounded-xl border border-stone-200 bg-white p-3"
              >
                <div className="font-medium text-stone-900">{rule.name}</div>
                <div className="mt-1 text-xs text-stone-600">
                  発動しきい値 {rule.threshold}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="flex min-h-11 items-center gap-1 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs text-rose-700 transition-colors duration-200 hover:bg-rose-50"
                    onClick={() => onDelete(rule.id)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    <span>削除</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
