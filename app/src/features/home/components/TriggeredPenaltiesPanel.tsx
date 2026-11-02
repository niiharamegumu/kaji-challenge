import { ChartColumn } from "lucide-react";
import { Link } from "../../../shared/router/navigation";

import type { PenaltyRule } from "../../../lib/api/operations";
import { TriggeredPenaltiesList } from "../../../shared/components/TriggeredPenaltiesList";
import { HOME_PANEL_CLASS_NAME } from "./panelStyles";

type Props = {
  triggeredPenaltyRuleIds: string[] | null | undefined;
  rules: PenaltyRule[] | null | undefined;
  summaryMonth: string;
};

export function TriggeredPenaltiesPanel({ triggeredPenaltyRuleIds, rules, summaryMonth }: Props) {
  return (
    <article className={HOME_PANEL_CLASS_NAME}>
      <div className="flex items-center justify-between gap-2 px-2 md:px-0">
        <h2 className="whitespace-nowrap text-base font-semibold sm:text-lg">今月のペナルティ</h2>
        <Link
          to={`/summary?month=${summaryMonth}`}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-line-strong bg-surface px-2 py-1.5 text-xs font-medium whitespace-nowrap text-body transition-colors hover:bg-surface-subtle hover:text-heading sm:gap-1.5 sm:px-2.5 sm:text-sm"
        >
          <ChartColumn size={16} aria-hidden="true" />
          <span>前月サマリー</span>
        </Link>
      </div>
      <TriggeredPenaltiesList
        triggeredPenaltyRuleIds={triggeredPenaltyRuleIds}
        rules={rules}
        emptyMessage="前月に発動したペナルティはありません。"
      />
    </article>
  );
}
