import { AlertTriangle, TriangleAlert } from "lucide-react";
import { useMemo } from "react";

import type { PenaltyRule } from "../../lib/api/operations";

type Props = {
  triggeredPenaltyRuleIds: string[] | null | undefined;
  rules: PenaltyRule[] | null | undefined;
  emptyMessage?: string;
};

export function TriggeredPenaltiesList({
  triggeredPenaltyRuleIds,
  rules,
  emptyMessage = "発動ペナルティはありません。",
}: Props) {
  const triggeredPenalties = useMemo(() => {
    const ruleMap = new Map((rules ?? []).map((rule) => [rule.id, rule]));

    return (triggeredPenaltyRuleIds ?? [])
      .map((id) => {
        const rule = ruleMap.get(id);
        if (rule == null) {
          return {
            id,
            name: `不明なルール (${id})`,
            threshold: -1,
            isUnknown: true,
          };
        }
        return {
          id,
          name: rule.name,
          threshold: rule.threshold,
          isUnknown: false,
        };
      })
      .sort((a, b) => {
        if (a.threshold !== b.threshold) {
          return b.threshold - a.threshold;
        }
        return a.name.localeCompare(b.name, "ja");
      });
  }, [rules, triggeredPenaltyRuleIds]);

  if (triggeredPenalties.length === 0) {
    return <p className="mt-3 px-2 text-sm text-muted md:px-0">{emptyMessage}</p>;
  }

  return (
    <ul className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
      {triggeredPenalties.map((penalty) => (
        <li
          key={penalty.id}
          className={`rounded-xl border p-2.5 ${penalty.isUnknown ? "border-warning-line bg-warning-hover/70" : "border-warning-line bg-warning-soft"}`}
        >
          <div className="flex items-center gap-2 text-warning-strong">
            {penalty.isUnknown ? (
              <TriangleAlert size={16} className="text-warning" aria-hidden="true" />
            ) : (
              <AlertTriangle size={16} className="text-warning" aria-hidden="true" />
            )}
            <p className="font-medium text-warning-strong">{penalty.name}</p>
          </div>
          <p className="mt-2 text-xs text-warning-strong">
            {penalty.isUnknown
              ? "ルール詳細を確認できません"
              : `発動しきい値: ${penalty.threshold}`}
          </p>
        </li>
      ))}
    </ul>
  );
}
