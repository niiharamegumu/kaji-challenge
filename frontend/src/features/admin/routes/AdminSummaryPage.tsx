import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { AlertTriangle, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  getPenaltySummaryMonthly,
  listPenaltyRules,
} from "../../../lib/api/generated/client";
import { queryKeys } from "../../../shared/query/queryKeys";
import { formatError } from "../../../shared/utils/errors";
import { isLoggedInAtom } from "../../../state/session";
import { statusMessageAtom } from "../../shell/state/status";

const monthPattern = /^\d{4}-\d{2}$/;

const initialMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

export function AdminSummaryPage() {
  const loggedIn = useAtomValue(isLoggedInAtom);
  const [month, setMonth] = useState(initialMonth);
  const [, setStatus] = useAtom(statusMessageAtom);

  const summaryQuery = useQuery({
    queryKey: [...queryKeys.monthlySummary, month],
    queryFn: async () => (await getPenaltySummaryMonthly({ month })).data,
    enabled: loggedIn && monthPattern.test(month),
  });

  const rulesQuery = useQuery({
    queryKey: queryKeys.rules,
    queryFn: async () => (await listPenaltyRules()).data.items,
    enabled: loggedIn,
  });

  useEffect(() => {
    if (summaryQuery.isError) {
      setStatus(
        `月次サマリー取得に失敗しました: ${formatError(summaryQuery.error)}`,
      );
    }
  }, [summaryQuery.error, summaryQuery.isError, setStatus]);

  useEffect(() => {
    if (rulesQuery.isError) {
      setStatus(
        `ペナルティルール取得に失敗しました: ${formatError(rulesQuery.error)}`,
      );
    }
  }, [rulesQuery.error, rulesQuery.isError, setStatus]);

  const ruleMap = useMemo(() => {
    return new Map((rulesQuery.data ?? []).map((rule) => [rule.id, rule]));
  }, [rulesQuery.data]);

  const triggeredPenalties = useMemo(() => {
    const ids = summaryQuery.data?.triggeredPenaltyRuleIds ?? [];
    return ids
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
  }, [summaryQuery.data?.triggeredPenaltyRuleIds, ruleMap]);

  return (
    <section className="mt-4 w-full pb-2">
      <article className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm animate-enter md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">月次サマリー</h2>
            <p className="mt-1 text-sm text-stone-600">減点状況</p>
          </div>
          <div className="grid gap-1">
            <label className="text-sm text-stone-700" htmlFor="summary-month">
              対象月
            </label>
            <input
              id="summary-month"
              type="month"
              className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 py-2"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </div>
        </div>

        <div className="mt-5">
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-sm text-stone-700">合計減点</p>
            <p className="mt-2 text-3xl font-bold text-stone-900">
              {summaryQuery.data?.totalPenalty ?? 0}
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-sm text-stone-700">日次減点</p>
            <p className="mt-2 text-2xl font-semibold text-stone-900">
              {summaryQuery.data?.dailyPenaltyTotal ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-sm text-stone-700">週次減点</p>
            <p className="mt-2 text-2xl font-semibold text-stone-900">
              {summaryQuery.data?.weeklyPenaltyTotal ?? 0}
            </p>
          </div>
        </div>

        <div className="mt-6 border-t border-stone-200 pt-5">
          <h3 className="text-base font-semibold">発生しているペナルティ</h3>

          {summaryQuery.isLoading || rulesQuery.isLoading ? (
            <p className="mt-3 text-sm text-stone-500">
              サマリーを読み込み中です...
            </p>
          ) : summaryQuery.isError || rulesQuery.isError ? (
            <p className="mt-3 text-sm text-rose-700">
              サマリー情報の取得に失敗しました。時間をおいて再読込してください。
            </p>
          ) : triggeredPenalties.length === 0 ? (
            <p className="mt-3 text-sm text-stone-500">
              発動ペナルティはありません。
            </p>
          ) : (
            <ul className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {triggeredPenalties.map((penalty) => (
                <li
                  key={penalty.id}
                  className={`rounded-xl border p-3 ${penalty.isUnknown ? "border-amber-300 bg-amber-50" : "border-stone-300 bg-white"}`}
                >
                  <div className="flex items-center gap-2">
                    {penalty.isUnknown ? (
                      <TriangleAlert
                        size={16}
                        className="text-amber-700"
                        aria-hidden="true"
                      />
                    ) : (
                      <AlertTriangle
                        size={16}
                        className="text-stone-600"
                        aria-hidden="true"
                      />
                    )}
                    <p className="font-medium text-stone-900">{penalty.name}</p>
                  </div>
                  <p className="mt-2 text-xs text-stone-600">
                    {penalty.isUnknown
                      ? "ルール詳細を確認できません"
                      : `発動しきい値: ${penalty.threshold}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </article>
    </section>
  );
}
