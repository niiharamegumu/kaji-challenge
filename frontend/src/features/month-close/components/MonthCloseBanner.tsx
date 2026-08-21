import { AlertTriangle, RotateCw } from "lucide-react";
import { Link } from "react-router-dom";

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
      <aside className="mx-2 mb-3 flex items-center justify-between gap-3 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm md:mx-4">
        <span className="text-stone-700">
          月次締めの状態を取得できませんでした。
        </span>
        <button
          type="button"
          aria-label="月次締め状態を再取得"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-stone-300 px-3 py-2 font-medium text-stone-700 hover:bg-stone-100"
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
    <aside className="mx-2 mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-amber-950 md:mx-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-2">
          <AlertTriangle
            className="mt-0.5 shrink-0 text-amber-700"
            size={18}
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              {formatMonth(candidate.month)}の月次締めが必要です
            </p>
            <p className="mt-1 text-xs text-amber-800">
              日次: {candidate.dailyThroughDate}まで・週次:{" "}
              {candidate.weeklyThroughDate}終了週まで
              {candidateQuery.data.pendingMonthCount > 1
                ? `（ほか${candidateQuery.data.pendingMonthCount - 1}か月）`
                : ""}
            </p>
          </div>
        </div>
        <Link
          to={`/admin/summary?month=${candidate.month}&close=1`}
          className="inline-flex min-h-10 shrink-0 items-center rounded-lg border border-amber-500 bg-amber-50 px-4 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-100"
        >
          この月を締める
        </Link>
      </div>
    </aside>
  );
}
