import { ChartColumn } from "lucide-react";
import { Link } from "react-router-dom";

import type { PenaltyRule } from "../../../lib/api/generated/client";
import { TriggeredPenaltiesList } from "../../../shared/components/TriggeredPenaltiesList";
import { HOME_PANEL_CLASS_NAME } from "./panelStyles";

type Props = {
  triggeredPenaltyRuleIds: string[] | null | undefined;
  rules: PenaltyRule[] | null | undefined;
  summaryMonth: string;
};

export function TriggeredPenaltiesPanel({
  triggeredPenaltyRuleIds,
  rules,
  summaryMonth,
}: Props) {
  return (
    <article className={HOME_PANEL_CLASS_NAME}>
      <div className="flex items-center justify-between gap-2 px-2 md:px-0">
        <h2 className="whitespace-nowrap text-base font-semibold sm:text-lg">
          今月のペナルティ
        </h2>
        <Link
          to={`/admin/summary?month=${summaryMonth}`}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-stone-300 bg-white px-2 py-1.5 text-xs font-medium whitespace-nowrap text-stone-700 transition-colors hover:bg-stone-50 hover:text-stone-900 sm:gap-1.5 sm:px-2.5 sm:text-sm"
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
