import { useMutation, useQueryClient, useSuspenseQueries } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Circle } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useOutletContext, useSearchParams } from "../../../shared/router/navigation";
import type { RootLayoutOutletContext } from "../../../shared/router/rootLayoutContext";
import { CompletionSlots } from "../../../shared/components/CompletionSlots";
import { ConfirmModal } from "../../../shared/components/ConfirmModal";
import { InfoHelp } from "../../../shared/components/InfoHelp";
import { TriggeredPenaltiesList } from "../../../shared/components/TriggeredPenaltiesList";
import {
  monthlyPenaltySummaryQueryOptions,
  penaltyRulesWithDeletedQueryOptions,
} from "../../../shared/query/monthlyPenaltyQueries";
import { queryKeys } from "../../../shared/query/queryKeys";
import { PAGE_SECTION_CHROMELESS_CLASS_NAME } from "../../../shared/styles/pageSection";
import {
  dateStringInJST,
  endOfWeekDateKey,
  formatMonthLabel,
  parseDateKey,
} from "../../../shared/utils/dates";
import { resolveSummaryMonth } from "../../../shared/router/dateParams";
import { summaryMonthSchema } from "../../../contracts/operations";
import { formatError } from "../../../shared/utils/errors";
import { closeMonth as closeMonthRequest, useMonthCloseCandidate } from "../../month-close";
import { PastTaskCompletionControl } from "../components/PastTaskCompletionControl";
import { usePastTaskCompletion } from "../hooks/usePastTaskCompletion";

const weekdayFormatter = new Intl.DateTimeFormat("ja-JP", { timeZone: "UTC", weekday: "short" });

const addMonth = (month: string, delta: number) => {
  const date = parseDateKey(`${month}-01`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
};

export function SummaryPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [, startTransition] = useTransition();
  const monthPickerRef = useRef<HTMLDivElement>(null);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [status, setStatus] = useState("");
  const currentDateKey = dateStringInJST();
  const month = resolveSummaryMonth(searchParams.get("month"), currentDateKey);

  const [summary, rules] = useSuspenseQueries({
    queries: [monthlyPenaltySummaryQueryOptions(month), penaltyRulesWithDeletedQueryOptions],
  });

  const { currentUserId, displayName, colorHex } = useOutletContext<RootLayoutOutletContext>();
  const completion = usePastTaskCompletion(
    month,
    summary.data,
    currentUserId ? { userId: currentUserId, effectiveName: displayName, colorHex } : undefined,
    setStatus,
  );
  const summaryData = completion.data;
  const monthCloseCandidate = useMonthCloseCandidate();
  const closeCandidate = monthCloseCandidate.data?.candidate;
  const monthlyTaskStatusGroups = summaryData.taskStatusByDate;

  const closeRequested = searchParams.get("close") === "1" && closeCandidate?.month === month;
  const clearCloseRequest = () => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("close");
        return next;
      },
      { replace: true },
    );
  };

  const closeMonthMutation = useMutation({
    mutationFn: () => closeMonthRequest(month),
    onSuccess: async () => {
      setStatus(`${formatMonthLabel(month)}を締めました`);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.monthCloseCandidate,
        }),
        queryClient.invalidateQueries({
          queryKey: [...queryKeys.monthlySummary, month],
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      ]);
    },
    onError: async (error) => {
      setStatus(`月次締め失敗: ${formatError(error)}`);
    },
  });

  const updateMonth = (nextMonth: string) => {
    if (!summaryMonthSchema.safeParse(nextMonth).success || nextMonth === month) {
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

  const [currentYear, currentMonth] = month.split("-").map(Number);
  const yearOptions = Array.from({ length: 7 }, (_, index) => currentYear - 3 + index);

  const selectYearMonth = (year: number, monthNumber: number) => {
    updateMonth(`${String(year).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}`);
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
              <p className="mt-1 [overflow-wrap:anywhere] text-sm text-secondary">{status}</p>
            ) : null}
          </div>
          <div className="grid w-full min-w-0 justify-items-stretch sm:ml-auto sm:w-auto sm:justify-items-end">
            <div className="grid w-full min-w-0 grid-cols-[2.25rem_minmax(0,1fr)_2.25rem] items-center gap-1.5 sm:w-auto sm:grid-cols-[2.75rem_13rem_2.75rem] sm:gap-2">
              <button
                type="button"
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-surface text-secondary transition-colors hover:bg-surface-muted sm:h-11 sm:w-11"
                onClick={() => updateMonth(addMonth(month, -1))}
                aria-label="前月へ移動"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <div className="relative flex-1" ref={monthPickerRef}>
                <button
                  type="button"
                  className="relative flex h-9 w-full cursor-pointer items-center justify-center rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink sm:h-11 sm:px-3 sm:py-2"
                  onClick={() => setMonthPickerOpen((open) => !open)}
                  aria-label="対象月を選択"
                >
                  <span className="w-full text-center">{formatMonthLabel(month)}</span>
                </button>

                {monthPickerOpen ? (
                  <div className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-line bg-surface p-2.5 shadow-xl">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-line-strong bg-surface text-body hover:bg-surface-muted"
                        onClick={() => selectYearMonth(currentYear - 1, currentMonth)}
                        aria-label="前年へ移動"
                      >
                        <ChevronLeft size={16} aria-hidden="true" />
                      </button>
                      <div className="relative flex-1">
                        <select
                          className="min-h-11 w-full appearance-none rounded-lg border border-line-strong bg-surface px-3 py-2 pr-12 text-sm text-ink"
                          value={currentYear}
                          onChange={(event) =>
                            selectYearMonth(Number(event.target.value), currentMonth)
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
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-secondary"
                          aria-hidden="true"
                        />
                      </div>
                      <button
                        type="button"
                        className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-line-strong bg-surface text-body hover:bg-surface-muted"
                        onClick={() => selectYearMonth(currentYear + 1, currentMonth)}
                        aria-label="翌年へ移動"
                      >
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                    </div>

                    <div className="mt-2 grid grid-cols-4 gap-2">
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((monthNumber) => (
                        <button
                          key={monthNumber}
                          type="button"
                          className={`min-h-11 rounded-lg border px-2 py-2 text-sm ${
                            monthNumber === currentMonth
                              ? "border-[color:var(--color-matcha-400)] bg-[color:var(--color-matcha-50)] text-[color:var(--color-matcha-700)]"
                              : "border-line bg-surface text-body hover:bg-surface-muted"
                          }`}
                          onClick={() => {
                            selectYearMonth(currentYear, monthNumber);
                            setMonthPickerOpen(false);
                          }}
                        >
                          {monthNumber}月
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-surface text-secondary transition-colors hover:bg-surface-muted sm:h-11 sm:w-11"
                onClick={() => updateMonth(addMonth(month, 1))}
                aria-label="翌月へ移動"
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3">
          <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-surface">
            <div className="p-3">
              <p className="text-xs text-body">合計減点</p>
              <p className="mt-1 text-3xl font-bold leading-none text-heading">
                {summaryData.totalPenalty}
              </p>
            </div>
            <div className="grid grid-rows-2 border-l border-line">
              <div className="flex items-end justify-between gap-2 p-3">
                <p className="text-xs text-body">日次減点</p>
                <p className="text-xl font-semibold leading-none text-heading">
                  {summaryData.dailyPenaltyTotal}
                </p>
              </div>
              <div className="flex items-end justify-between gap-2 border-t border-line p-3">
                <p className="text-xs text-body">週次減点</p>
                <p className="text-xl font-semibold leading-none text-heading">
                  {summaryData.weeklyPenaltyTotal}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 border-t border-line pt-3">
          <h3 className="px-2 text-base font-semibold md:px-0">発生しているペナルティ</h3>

          <TriggeredPenaltiesList
            triggeredPenaltyRuleIds={summaryData.triggeredPenaltyRuleIds}
            rules={rules.data}
          />
        </div>

        <div className="mt-4 border-t border-line pt-3">
          <div className="flex items-center gap-1 px-2 md:px-0">
            <h3 className="text-base font-semibold">日次サマリー</h3>
            {summaryData.isClosed ? (
              <>
                <span className="ml-1 text-xs text-secondary">締め済み</span>
                <InfoHelp label="締め済み月の再計算について">
                  締め済み月のタスクを変更すると、操作対象外を含め、現在設定で月全体の合計減点と発動ペナルティを再計算します。
                </InfoHelp>
              </>
            ) : null}
          </div>

          {monthlyTaskStatusGroups.length === 0 ? (
            <p className="mt-3 px-2 text-sm text-muted md:px-0">対象月のタスク履歴はありません。</p>
          ) : (
            <div className="mt-2 space-y-3">
              {monthlyTaskStatusGroups.map((group) => {
                const date = parseDateKey(group.date);
                const weekday = weekdayFormatter.format(date);
                const isCrossMonthWeek = date.getUTCDay() !== 1;

                return (
                  <section key={group.date}>
                    <h4
                      className={`flex items-center gap-2 px-2 text-sm font-semibold md:px-0 ${
                        group.date < currentDateKey ? "text-faint" : "text-ink"
                      }`}
                    >
                      <span>{`${date.getUTCMonth() + 1}月${date.getUTCDate()}日（${weekday}）`}</span>
                      {group.date === currentDateKey ? (
                        <span className="rounded-full bg-action px-2 py-0.5 text-[10px] font-semibold leading-4 text-on-action">
                          今日
                        </span>
                      ) : null}
                    </h4>
                    <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                      {group.items.map((item) => {
                        const isWeekly = item.type === "weekly";
                        const showCrossMonthBadge = isWeekly && isCrossMonthWeek;
                        const canAdjustPastDaily =
                          group.date < currentDateKey && item.type === "daily";
                        const canAdjustPastWeekly =
                          item.type === "weekly" && endOfWeekDateKey(group.date) < currentDateKey;
                        return (
                          <li
                            key={`${group.date}-${item.taskId}`}
                            className={`p-2.5 text-sm ${
                              item.completed
                                ? "bg-[color:var(--color-matcha-50)]"
                                : "bg-danger-soft"
                            }`}
                          >
                            <div className="min-w-0">
                              <p
                                className={`font-medium text-heading ${item.completed ? "line-through text-muted" : ""}`}
                              >
                                {item.title}
                                {item.isDeleted ? "（削除済み）" : ""}
                              </p>
                              {item.notes != null && item.notes !== "" ? (
                                <p
                                  className={`mt-1 whitespace-pre-wrap break-words text-xs text-secondary ${item.completed ? "line-through text-faint" : ""}`}
                                >
                                  {item.notes}
                                </p>
                              ) : null}
                              <div className="mt-1 flex items-center justify-between gap-2">
                                <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
                                  <span
                                    className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold leading-4 ${
                                      isWeekly
                                        ? "bg-action text-on-action"
                                        : "border border-line-strong bg-surface text-heading"
                                    }`}
                                  >
                                    {isWeekly ? "週間" : "日間"}
                                  </span>
                                  <span
                                    className={`inline-flex items-center gap-1 whitespace-nowrap ${
                                      item.completed
                                        ? "text-[color:var(--color-matcha-700)]"
                                        : "text-danger"
                                    }`}
                                  >
                                    {item.completed ? (
                                      <CheckCircle2 size={12} aria-hidden="true" />
                                    ) : (
                                      <Circle size={12} aria-hidden="true" />
                                    )}
                                    {item.completed ? "完了" : "未完了"}
                                  </span>
                                  <span
                                    className={`text-muted ${item.completed ? "line-through" : ""}`}
                                  >
                                    減点 {item.penaltyPoints} 点
                                  </span>
                                  {showCrossMonthBadge ? (
                                    <span className="inline-flex items-center rounded-full bg-warning-hover px-2 py-0.5 font-semibold leading-4 text-warning-strong">
                                      週は前月から継続
                                    </span>
                                  ) : null}
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  {canAdjustPastDaily || canAdjustPastWeekly ? (
                                    <PastTaskCompletionControl
                                      item={item}
                                      targetDate={group.date}
                                      isSaving={completion.isSaving({
                                        taskId: item.taskId,
                                        targetDate: group.date,
                                        type: item.type,
                                      })}
                                      onUpdate={completion.update}
                                    />
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
        isOpen={closeRequested}
        tone="warning"
        title={`${formatMonthLabel(month)}を締めますか？`}
        message={
          closeCandidate == null
            ? ""
            : `${closeCandidate.dailyThroughDate}までの日次と、終了日の日曜日が${formatMonthLabel(month)}に属する${closeCandidate.weeklyThroughDate}までの週次を対象にします。月またぎ週は終了日を含む月へ計上し、現在のタスク設定とルールで月全体を再計算します。`
        }
        confirmLabel="再計算して締める"
        onCancel={() => {
          clearCloseRequest();
        }}
        onConfirm={() => {
          if (!closeMonthMutation.isPending) {
            clearCloseRequest();
            void closeMonthMutation.mutateAsync();
          }
        }}
      />
    </section>
  );
}
