import {
  useMutation,
  useQueryClient,
  useSuspenseQueries,
} from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useSearchParams } from "react-router-dom";

import {
  getPenaltySummaryMonthly,
  listPenaltyRules,
  postTaskCompletionToggle,
} from "../../../lib/api/generated/client";
import { CompletionSlots } from "../../../shared/components/CompletionSlots";
import { queryKeys } from "../../../shared/query/queryKeys";
import { PAGE_SECTION_CHROMELESS_CLASS_NAME } from "../../../shared/styles/pageSection";
import { dateStringInJST, formatError } from "../../../shared/utils/errors";
import { handleTeamStatePreconditionFailure } from "../../shell/lib/teamStateRefresh";
import { ConfirmModal } from "../components/ConfirmModal";

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

const asArray = <T,>(value: T[] | null | undefined): T[] => {
  if (Array.isArray(value)) {
    return value;
  }
  return [];
};

export function AdminSummaryPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [, startTransition] = useTransition();
  const monthPickerRef = useRef<HTMLDivElement>(null);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [confirmTarget, setConfirmTarget] = useState<{
    taskId: string;
    taskTitle: string;
    date: string;
  } | null>(null);
  const monthFromUrl = searchParams.get("month");
  const month =
    monthFromUrl != null && monthPattern.test(monthFromUrl)
      ? monthFromUrl
      : initialMonth();

  const [summary, rules] = useSuspenseQueries({
    queries: [
      {
        queryKey: [...queryKeys.monthlySummary, month],
        queryFn: async () => (await getPenaltySummaryMonthly({ month })).data,
      },
      {
        queryKey: [...queryKeys.rules, "withDeleted"],
        queryFn: async () =>
          (await listPenaltyRules({ includeDeleted: true })).data.items,
      },
    ],
  });

  const summaryData = summary.data;
  const rulesData = asArray(rules.data);
  const triggeredPenaltyRuleIds = asArray(summaryData.triggeredPenaltyRuleIds);
  const monthlyTaskStatusGroups = asArray(summaryData.taskStatusByDate);

  const ruleMap = useMemo(() => {
    return new Map(rulesData.map((rule) => [rule.id, rule]));
  }, [rulesData]);

  const triggeredPenalties = useMemo(() => {
    return triggeredPenaltyRuleIds
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
  }, [triggeredPenaltyRuleIds, ruleMap]);
  const currentDateKey = useMemo(() => dateStringInJST(), []);
  const currentMonthKey = currentDateKey.slice(0, 7);

  const completePastDailyTask = useMutation({
    mutationFn: async ({
      taskId,
      targetDate,
    }: {
      taskId: string;
      targetDate: string;
    }) =>
      postTaskCompletionToggle(taskId, {
        targetDate,
        action: "complete",
      }),
    onSuccess: async () => {
      setStatus("過去日タスクを完了に更新しました");
      setConfirmTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.monthlySummary }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      ]);
    },
    onError: async (error) => {
      if (
        await handleTeamStatePreconditionFailure(error, queryClient, setStatus)
      ) {
        setConfirmTarget(null);
        return;
      }
      setStatus(`更新失敗: ${formatError(error)}`);
    },
  });

  const updateMonth = (nextMonth: string) => {
    if (!monthPattern.test(nextMonth) || nextMonth === month) {
      return;
    }
    startTransition(() => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("month", nextMonth);
          return next;
        },
        { replace: true },
      );
    });
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
    <section className="mt-2 w-full pb-1 md:mt-4">
      <article
        className={`animate-enter rounded-xl px-0 py-2.5 md:rounded-2xl md:p-6 ${PAGE_SECTION_CHROMELESS_CLASS_NAME}`}
      >
        <div className="flex min-w-0 flex-col gap-2 px-2 sm:flex-row sm:items-start sm:justify-between md:px-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">月次サマリー</h2>
            {status !== "" ? (
              <p className="mt-1 [overflow-wrap:anywhere] text-sm text-stone-600">
                {status}
              </p>
            ) : null}
          </div>
          <div className="grid w-full min-w-0 justify-items-stretch sm:ml-auto sm:w-auto sm:justify-items-end">
            <div className="grid w-full min-w-0 grid-cols-[2.25rem_minmax(0,1fr)_2.25rem] items-center gap-1.5 sm:w-auto sm:grid-cols-[2.75rem_13rem_2.75rem] sm:gap-2">
              <button
                type="button"
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-stone-300 bg-white text-stone-600 transition-colors hover:bg-stone-100 sm:h-11 sm:w-11"
                onClick={() => updateMonth(addMonth(month, -1))}
                aria-label="前月へ移動"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <div className="relative flex-1" ref={monthPickerRef}>
                <button
                  type="button"
                  className="relative flex h-9 w-full cursor-pointer items-center justify-center rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-800 sm:h-11 sm:px-3 sm:py-2"
                  onClick={() => setMonthPickerOpen((open) => !open)}
                  aria-label="対象月を選択"
                >
                  <span className="w-full text-center">
                    {formatMonthLabel(month)}
                  </span>
                </button>

                {monthPickerOpen ? (
                  <div className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-stone-200 bg-white p-2.5 shadow-xl">
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
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-stone-300 bg-white text-stone-600 transition-colors hover:bg-stone-100 sm:h-11 sm:w-11"
                onClick={() => updateMonth(addMonth(month, 1))}
                aria-label="翌月へ移動"
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3">
          <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-stone-200 bg-white">
            <div className="p-3">
              <p className="text-xs text-stone-700">合計減点</p>
              <p className="mt-1 text-3xl font-bold leading-none text-stone-900">
                {summaryData.totalPenalty}
              </p>
            </div>
            <div className="grid grid-rows-2 border-l border-stone-200">
              <div className="flex items-end justify-between gap-2 p-3">
                <p className="text-xs text-stone-700">日次減点</p>
                <p className="text-xl font-semibold leading-none text-stone-900">
                  {summaryData.dailyPenaltyTotal}
                </p>
              </div>
              <div className="flex items-end justify-between gap-2 border-t border-stone-200 p-3">
                <p className="text-xs text-stone-700">週次減点</p>
                <p className="text-xl font-semibold leading-none text-stone-900">
                  {summaryData.weeklyPenaltyTotal}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 border-t border-stone-200 pt-3">
          <h3 className="px-2 text-base font-semibold md:px-0">
            発生しているペナルティ
          </h3>

          {triggeredPenalties.length === 0 ? (
            <p className="mt-3 px-2 text-sm text-stone-500 md:px-0">
              発動ペナルティはありません。
            </p>
          ) : (
            <ul className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {triggeredPenalties.map((penalty) => (
                <li
                  key={penalty.id}
                  className={`rounded-xl border p-2.5 ${penalty.isUnknown ? "border-amber-300 bg-amber-100/70" : "border-amber-300 bg-amber-50"}`}
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

        <div className="mt-4 border-t border-stone-200 pt-3">
          <h3 className="px-2 text-base font-semibold md:px-0">日次サマリー</h3>

          {monthlyTaskStatusGroups.length === 0 ? (
            <p className="mt-3 px-2 text-sm text-stone-500 md:px-0">
              対象月のタスク履歴はありません。
            </p>
          ) : (
            <div className="mt-2 space-y-3">
              {monthlyTaskStatusGroups.map((group) => {
                const date = dateFromDateKey(group.date);
                const weekday = new Intl.DateTimeFormat("ja-JP", {
                  weekday: "short",
                }).format(date);
                const isCrossMonthWeek = date.getDay() !== 1;

                return (
                  <section key={group.date}>
                    <h4
                      className={`flex items-center gap-2 px-2 text-sm font-semibold md:px-0 ${
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
                        const canCompletePastDaily =
                          !summaryData.isClosed &&
                          month === currentMonthKey &&
                          group.date < currentDateKey &&
                          item.type === "daily" &&
                          !item.completed;
                        return (
                          <li
                            key={`${group.date}-${item.taskId}`}
                            className={`p-2.5 text-sm ${
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
                              {item.notes != null && item.notes !== "" ? (
                                <p
                                  className={`mt-1 whitespace-pre-wrap break-words text-xs text-stone-600 ${item.completed ? "line-through text-stone-400" : ""}`}
                                >
                                  {item.notes}
                                </p>
                              ) : null}
                              <div className="mt-1 flex items-center justify-between gap-2">
                                <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
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
                                    className={`inline-flex items-center gap-1 whitespace-nowrap ${
                                      item.completed
                                        ? "text-[color:var(--color-matcha-700)]"
                                        : "text-rose-700"
                                    }`}
                                  >
                                    {item.completed ? (
                                      <CheckCircle2
                                        size={12}
                                        aria-hidden="true"
                                      />
                                    ) : (
                                      <Circle size={12} aria-hidden="true" />
                                    )}
                                    {item.completed ? "完了" : "未完了"}
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
                                <div className="flex shrink-0 items-center gap-1.5">
                                  {canCompletePastDaily ? (
                                    <button
                                      type="button"
                                      aria-label="過去日タスクを完了にする"
                                      title="完了にする"
                                      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[color:var(--color-matcha-400)] bg-white text-[color:var(--color-matcha-700)] transition-colors hover:bg-[color:var(--color-matcha-50)]"
                                      onClick={() =>
                                        setConfirmTarget({
                                          taskId: item.taskId,
                                          taskTitle: item.title,
                                          date: group.date,
                                        })
                                      }
                                    >
                                      <Check size={12} aria-hidden="true" />
                                    </button>
                                  ) : (
                                    <CompletionSlots
                                      compact
                                      className="justify-end"
                                      slots={item.completionSlots}
                                    />
                                  )}
                                </div>
                              </div>
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
      <ConfirmModal
        isOpen={confirmTarget != null}
        title="過去日のタスクを完了に変更しますか？"
        message={
          confirmTarget == null
            ? ""
            : `${confirmTarget.date} の「${confirmTarget.taskTitle}」を完了済みに変更します。当月中の過去分だけ操作でき、この操作は確定後に未完了へ戻せません。`
        }
        confirmLabel="完了にする"
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => {
          if (confirmTarget == null || completePastDailyTask.isPending) {
            return;
          }
          void completePastDailyTask.mutateAsync({
            taskId: confirmTarget.taskId,
            targetDate: confirmTarget.date,
          });
        }}
      />
    </section>
  );
}
