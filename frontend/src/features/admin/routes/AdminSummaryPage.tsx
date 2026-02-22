import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

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

const addMonth = (month: string, delta: number) => {
  const [yearPart, monthPart] = month.split("-");
  const year = Number(yearPart);
  const monthIndex = Number(monthPart) - 1;
  if (Number.isNaN(year) || Number.isNaN(monthIndex)) {
    return month;
  }
  const d = new Date(year, monthIndex + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const formatMonthLabel = (month: string) => {
  const [yearPart, monthPart] = month.split("-");
  if (yearPart == null || monthPart == null) {
    return month;
  }
  return `${yearPart}年${monthPart}月`;
};

const dateFromDateKey = (dateKey: string) => {
  const [yearPart, monthPart, dayPart] = dateKey.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return new Date(`${dateKey}T00:00:00`);
  }
  return new Date(year, month - 1, day);
};

export function AdminSummaryPage() {
  const loggedIn = useAtomValue(isLoggedInAtom);
  const [searchParams, setSearchParams] = useSearchParams();
  const monthPickerRef = useRef<HTMLDivElement>(null);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [, setStatus] = useAtom(statusMessageAtom);
  const monthFromUrl = searchParams.get("month");
  const month =
    monthFromUrl != null && monthPattern.test(monthFromUrl)
      ? monthFromUrl
      : initialMonth();

  const summaryQuery = useQuery({
    queryKey: [...queryKeys.monthlySummary, month],
    queryFn: async () => (await getPenaltySummaryMonthly({ month })).data,
    enabled: loggedIn && monthPattern.test(month),
  });

  const rulesQuery = useQuery({
    queryKey: [...queryKeys.rules, "withDeleted"],
    queryFn: async () =>
      (await listPenaltyRules({ includeDeleted: true })).data.items,
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

  const monthlyTaskStatusGroups = useMemo(() => {
    return summaryQuery.data?.taskStatusByDate ?? [];
  }, [summaryQuery.data?.taskStatusByDate]);
  const currentDateKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}`;
  }, []);

  const updateMonth = (nextMonth: string) => {
    if (!monthPattern.test(nextMonth)) {
      return;
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("month", nextMonth);
        return next;
      },
      { replace: true },
    );
  };

  const [currentYear, currentMonth] = useMemo(() => {
    const [yearPart, monthPart] = month.split("-");
    return [Number(yearPart), Number(monthPart)];
  }, [month]);

  const yearOptions = useMemo(() => {
    if (Number.isNaN(currentYear)) {
      return [];
    }
    return Array.from({ length: 7 }, (_, i) => currentYear - 3 + i);
  }, [currentYear]);

  const selectYearMonth = (year: number, monthNumber: number) => {
    updateMonth(`${year}-${String(monthNumber).padStart(2, "0")}`);
  };

  useEffect(() => {
    if (!monthPickerOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (
        monthPickerRef.current != null &&
        !monthPickerRef.current.contains(event.target as Node)
      ) {
        setMonthPickerOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [monthPickerOpen]);

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
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border border-stone-300 bg-white text-stone-600 transition-colors hover:bg-stone-100"
                onClick={() => updateMonth(addMonth(month, -1))}
                aria-label="前月へ移動"
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <div className="relative flex-1" ref={monthPickerRef}>
                <button
                  type="button"
                  className="relative flex min-h-11 w-full cursor-pointer items-center justify-between rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800"
                  onClick={() => setMonthPickerOpen((open) => !open)}
                  aria-label="対象月を選択"
                >
                  <span>{formatMonthLabel(month)}</span>
                </button>

                {monthPickerOpen ? (
                  <div className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-stone-200 bg-white p-3 shadow-xl">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-stone-300 bg-white text-stone-700 hover:bg-stone-100"
                        onClick={() =>
                          selectYearMonth(currentYear - 1, currentMonth)
                        }
                        aria-label="前年へ移動"
                      >
                        <ChevronLeft size={16} aria-hidden="true" />
                      </button>
                      <div className="relative flex-1">
                        <select
                          className="min-h-11 w-full appearance-none rounded-lg border border-stone-300 bg-white px-3 py-2 pr-12 text-sm text-stone-800"
                          value={currentYear}
                          onChange={(event) =>
                            selectYearMonth(
                              Number(event.target.value),
                              currentMonth,
                            )
                          }
                          aria-label="年を選択"
                        >
                          {yearOptions.map((year) => (
                            <option key={year} value={year}>
                              {year}年
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={16}
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-stone-600"
                          aria-hidden="true"
                        />
                      </div>
                      <button
                        type="button"
                        className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-stone-300 bg-white text-stone-700 hover:bg-stone-100"
                        onClick={() =>
                          selectYearMonth(currentYear + 1, currentMonth)
                        }
                        aria-label="翌年へ移動"
                      >
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                    </div>

                    <div className="mt-2 grid grid-cols-4 gap-2">
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(
                        (monthNumber) => (
                          <button
                            key={monthNumber}
                            type="button"
                            className={`min-h-11 rounded-lg border px-2 py-2 text-sm ${
                              monthNumber === currentMonth
                                ? "border-[color:var(--color-matcha-400)] bg-[color:var(--color-matcha-50)] text-[color:var(--color-matcha-700)]"
                                : "border-stone-200 bg-white text-stone-700 hover:bg-stone-100"
                            }`}
                            onClick={() => {
                              selectYearMonth(currentYear, monthNumber);
                              setMonthPickerOpen(false);
                            }}
                          >
                            {monthNumber}月
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border border-stone-300 bg-white text-stone-600 transition-colors hover:bg-stone-100"
                onClick={() => updateMonth(addMonth(month, 1))}
                aria-label="翌月へ移動"
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
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
                  className={`rounded-xl border p-3 ${penalty.isUnknown ? "border-amber-300 bg-amber-100/70" : "border-amber-300 bg-amber-50"}`}
                >
                  <div className="flex items-center gap-2 text-amber-800">
                    {penalty.isUnknown ? (
                      <TriangleAlert
                        size={16}
                        className="text-amber-700"
                        aria-hidden="true"
                      />
                    ) : (
                      <AlertTriangle
                        size={16}
                        className="text-amber-700"
                        aria-hidden="true"
                      />
                    )}
                    <p className="font-medium text-amber-900">{penalty.name}</p>
                  </div>
                  <p className="mt-2 text-xs text-amber-800">
                    {penalty.isUnknown
                      ? "ルール詳細を確認できません"
                      : `発動しきい値: ${penalty.threshold}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 border-t border-stone-200 pt-5">
          <h3 className="text-base font-semibold">日次サマリー</h3>

          {summaryQuery.isLoading ? (
            <p className="mt-3 text-sm text-stone-500">
              一覧を読み込み中です...
            </p>
          ) : summaryQuery.isError ? (
            <p className="mt-3 text-sm text-rose-700">
              完了タスク一覧の取得に失敗しました。
            </p>
          ) : monthlyTaskStatusGroups.length === 0 ? (
            <p className="mt-3 text-sm text-stone-500">
              対象月のタスク履歴はありません。
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              {monthlyTaskStatusGroups.map((group) => {
                const date = dateFromDateKey(group.date);
                const weekday = new Intl.DateTimeFormat("ja-JP", {
                  weekday: "short",
                }).format(date);
                const isCrossMonthWeek = date.getDay() !== 1;

                return (
                  <section key={group.date} className="px-1">
                    <h4
                      className={`flex items-center gap-2 text-sm font-semibold ${
                        group.date < currentDateKey
                          ? "text-stone-400"
                          : "text-stone-800"
                      }`}
                    >
                      <span>
                        {`${date.getMonth() + 1}月${date.getDate()}日（${weekday}）`}
                      </span>
                      {group.date === currentDateKey ? (
                        <span className="rounded-full bg-stone-900 px-2 py-0.5 text-[10px] font-semibold leading-4 text-white">
                          今日
                        </span>
                      ) : null}
                    </h4>
                    <ul className="mt-2 divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white">
                      {group.items.map((item) => {
                        const isWeekly = item.type === "weekly";
                        const showCrossMonthBadge =
                          isWeekly && isCrossMonthWeek;
                        return (
                          <li
                            key={`${group.date}-${item.taskId}`}
                            className={`p-3 text-sm ${
                              item.completed
                                ? "bg-[color:var(--color-matcha-50)]"
                                : "bg-rose-50"
                            }`}
                          >
                            <div className="min-w-0">
                              <p
                                className={`font-medium text-stone-900 ${item.completed ? "line-through text-stone-500" : ""}`}
                              >
                                {item.title}
                                {item.isDeleted ? "（削除済み）" : ""}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                                <span
                                  className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold leading-4 ${
                                    isWeekly
                                      ? "bg-stone-900 text-white"
                                      : "border border-stone-300 bg-white text-stone-900"
                                  }`}
                                >
                                  {isWeekly ? "週間" : "日間"}
                                </span>
                                <span
                                  className={`text-stone-500 ${item.completed ? "line-through" : ""}`}
                                >
                                  減点 {item.penaltyPoints} 点
                                </span>
                                {showCrossMonthBadge ? (
                                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 font-semibold leading-4 text-amber-800">
                                    週は前月から継続
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <div className="mt-2">
                              <span
                                className={`inline-flex items-center gap-1 whitespace-nowrap text-xs ${
                                  item.completed
                                    ? "text-[color:var(--color-matcha-700)]"
                                    : "text-rose-700"
                                }`}
                              >
                                {item.completed ? (
                                  <CheckCircle2 size={14} aria-hidden="true" />
                                ) : (
                                  <Circle size={14} aria-hidden="true" />
                                )}
                                {item.completed ? "完了" : "未完了"}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </article>
    </section>
  );
}
