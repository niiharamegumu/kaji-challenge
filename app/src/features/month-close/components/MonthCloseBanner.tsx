import { AlertTriangle, RotateCw } from "lucide-react";
import { Link } from "../../../shared/router/navigation";

import { useMonthCloseCandidate } from "../hooks/useMonthCloseCandidate";

const formatMonth = (month: string) => {
  const [year, value] = month.split("-");
  return `${year}年${Number(value)}月`;
};

export function MonthCloseBanner() {
  const candidateQuery = useMonthCloseCandidate();

  if (candidateQuery.isPending) {
    return null;
  }
  if (candidateQuery.isError) {
    return (
      <aside className="mx-2 mb-3 flex items-center justify-between gap-3 rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm md:mx-4">
        <span className="text-body">月次締めの状態を取得できませんでした。</span>
        <button
          type="button"
          aria-label="月次締め状態を再取得"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line-strong px-3 py-2 font-medium text-body hover:bg-surface-muted"
          onClick={() => void candidateQuery.refetch()}
        >
          <RotateCw size={14} aria-hidden="true" />
          再試行
        </button>
      </aside>
    );
  }

  const candidate = candidateQuery.data.candidate;
  if (candidate == null) {
    return null;
  }

  return (
    <aside className="mx-2 mb-3 rounded-xl border border-warning-line bg-warning-soft px-3 py-3 text-warning-strong md:mx-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-2">
          <AlertTriangle className="mt-0.5 shrink-0 text-warning" size={18} aria-hidden="true" />
          <div>
            <p className="font-semibold">{formatMonth(candidate.month)}の月次締めが必要です</p>
            <p className="mt-1 text-xs text-warning-strong">
              日次: {candidate.dailyThroughDate}まで・週次: {candidate.weeklyThroughDate}終了週まで
              {candidateQuery.data.pendingMonthCount > 1
                ? `（ほか${candidateQuery.data.pendingMonthCount - 1}か月）`
                : ""}
            </p>
          </div>
        </div>
        <Link
          to={`/summary?month=${candidate.month}&close=1`}
          className="inline-flex min-h-10 shrink-0 items-center rounded-lg border border-warning-line bg-warning-soft px-4 text-sm font-semibold text-warning-strong transition-colors hover:bg-warning-hover"
        >
          この月を締める
        </Link>
      </div>
    </aside>
  );
}
