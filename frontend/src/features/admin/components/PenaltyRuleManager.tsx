import { CirclePlus, Pencil, Trash2, X } from "lucide-react";
import type { ChangeEvent } from "react";
import { useMemo, useState } from "react";

import type {
  PenaltyRule,
  UpdatePenaltyRuleRequest,
} from "../../../lib/api/generated/client";
import type { RuleFormState } from "../state/forms";

type Props = {
  form: RuleFormState;
  rules: PenaltyRule[];
  onFormChange: (updater: (prev: RuleFormState) => RuleFormState) => void;
  onCreate: () => void;
  onDelete: (ruleId: string) => void;
  onUpdate: (
    ruleId: string,
    payload: UpdatePenaltyRuleRequest,
  ) => Promise<void>;
};

export function PenaltyRuleManager({
  form,
  rules,
  onFormChange,
  onCreate,
  onDelete,
  onUpdate,
}: Props) {
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const handleChange =
    (key: keyof RuleFormState) => (event: ChangeEvent<HTMLInputElement>) => {
      onFormChange((prev) => ({ ...prev, [key]: event.target.value }));
    };

  const sortedRules = useMemo(
    () => [...rules].sort((a, b) => b.threshold - a.threshold),
    [rules],
  );

  const startEdit = (rule: PenaltyRule) => {
    setEditingRuleId(rule.id);
    setEditName(rule.name);
  };

  const cancelEdit = () => {
    setEditingRuleId(null);
    setEditName("");
  };

  const saveEdit = async (ruleId: string) => {
    const name = editName.trim();
    if (name.length === 0) {
      return;
    }
    await onUpdate(ruleId, { name });
    cancelEdit();
  };

  return (
    <article className="animate-enter rounded-xl border border-stone-200 bg-white/90 p-2.5 shadow-sm md:rounded-2xl md:p-6">
      <h2 className="text-lg font-semibold">ペナルティ管理</h2>
      <div className="mt-3 grid gap-1.5">
        <label
          className="text-xs text-stone-700 sm:text-sm"
          htmlFor="rule-name"
        >
          ルール名
        </label>
        <input
          id="rule-name"
          className="h-10 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm sm:h-11"
          value={form.name}
          onChange={handleChange("name")}
        />
        <label
          className="text-xs text-stone-700 sm:text-sm"
          htmlFor="rule-threshold"
        >
          発動しきい値
        </label>
        <input
          id="rule-threshold"
          className="h-10 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm sm:h-11"
          type="number"
          min={1}
          value={form.threshold}
          onChange={handleChange("threshold")}
        />
        <div className="mt-1 flex justify-start">
          <button
            type="button"
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-3 py-2 text-sm text-white transition-colors duration-200 hover:bg-stone-800 sm:h-11 sm:w-auto sm:min-w-40"
            onClick={onCreate}
          >
            <CirclePlus size={16} aria-hidden="true" />
            <span>ルール追加</span>
          </button>
        </div>
      </div>
      <div className="mt-4 border-t border-stone-200 pt-3">
        {sortedRules.length === 0 ? (
          <p className="text-sm text-stone-500">
            ペナルティルールはまだありません。
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {sortedRules.map((rule) => {
              const isEditing = editingRuleId === rule.id;
              const canSave = editName.trim().length > 0;
              return (
                <li
                  key={rule.id}
                  className="rounded-xl border border-stone-200 bg-white p-2.5"
                >
                  {isEditing ? (
                    <div className="grid gap-2">
                      <label
                        className="text-xs text-stone-700"
                        htmlFor={`rule-edit-name-${rule.id}`}
                      >
                        ルール名
                      </label>
                      <input
                        id={`rule-edit-name-${rule.id}`}
                        className="h-10 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm sm:h-11"
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                      />
                    </div>
                  ) : (
                    <div className="font-medium text-stone-900">
                      {rule.name}
                    </div>
                  )}
                  {isEditing ? (
                    <>
                      <div className="mt-1 text-xs text-stone-600">
                        しきい値 {rule.threshold}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <>
                          <button
                            type="button"
                            className="flex h-9 items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-xs text-emerald-700 transition-colors duration-200 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 sm:h-11 sm:px-3 sm:py-2"
                            onClick={() => {
                              void saveEdit(rule.id);
                            }}
                            disabled={!canSave}
                          >
                            <span>保存</span>
                          </button>
                          <button
                            type="button"
                            className="flex h-9 items-center gap-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs text-stone-700 transition-colors duration-200 hover:bg-stone-100 sm:h-11 sm:px-3 sm:py-2"
                            onClick={cancelEdit}
                          >
                            <X size={14} aria-hidden="true" />
                            <span className="sr-only sm:not-sr-only">
                              キャンセル
                            </span>
                          </button>
                        </>
                      </div>
                    </>
                  ) : (
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <div className="text-xs text-stone-600">
                        しきい値 {rule.threshold}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          className="flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-700 transition-colors duration-200 hover:bg-stone-100 sm:h-9 sm:w-9"
                          onClick={() => startEdit(rule)}
                        >
                          <Pencil size={14} aria-hidden="true" />
                          <span className="sr-only">編集</span>
                        </button>
                        <button
                          type="button"
                          className="flex h-8 w-8 items-center justify-center rounded-md border border-rose-300 bg-white text-rose-700 transition-colors duration-200 hover:bg-rose-50 sm:h-9 sm:w-9"
                          onClick={() => onDelete(rule.id)}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          <span className="sr-only">削除</span>
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </article>
  );
}
