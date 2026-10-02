import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "../../../test/router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppProviders } from "../../../app/providers";
import { SuspenseQueryBoundary } from "../../../shared/components/SuspenseQueryBoundary";
import { appQueryClient } from "../../../shared/query/queryClient";
import { dateStringInJST } from "../../../shared/utils/dates";
import { withExpectedConsoleError } from "../../../test/console";
import { SummaryPage } from "./SummaryPage";
import { RootLayoutContext } from "../../../shared/router/rootLayoutContext";

const mockGetPenaltySummaryMonthly = vi.fn();
const mockListPenaltyRules = vi.fn();
const mockPostTaskCompletionToggle = vi.fn();
const mockGetMonthCloseCandidate = vi.fn();
const mockPostMonthClose = vi.fn();
const mockDateStringInJST = vi.fn();

const formatJstDate = (date: Date) => {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const getPart = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
};

vi.mock("../../../lib/api/operations", async () => {
  const actual = await vi.importActual<object>("../../../lib/api/operations");
  return {
    ...actual,
    getPenaltySummaryMonthly: (...args: unknown[]) => mockGetPenaltySummaryMonthly(...args),
    listPenaltyRules: (...args: unknown[]) => mockListPenaltyRules(...args),
    postTaskCompletion: (...args: unknown[]) => mockPostTaskCompletionToggle(...args),
    getMonthCloseCandidate: (...args: unknown[]) => mockGetMonthCloseCandidate(...args),
    postMonthClose: (...args: unknown[]) => mockPostMonthClose(...args),
  };
});

vi.mock("../../../shared/utils/dates", async () => {
  const actual = await vi.importActual<object>("../../../shared/utils/dates");
  return {
    ...actual,
    dateStringInJST: (...args: unknown[]) => mockDateStringInJST(...args),
  };
});

describe("SummaryPage", () => {
  beforeEach(() => {
    appQueryClient.clear();
    mockGetPenaltySummaryMonthly.mockReset();
    mockListPenaltyRules.mockReset();
    mockPostTaskCompletionToggle.mockReset();
    mockGetMonthCloseCandidate.mockReset();
    mockPostMonthClose.mockReset();
    mockDateStringInJST.mockReset();
    mockDateStringInJST.mockImplementation((date?: Date) => {
      if (date == null) {
        return "2026-03-17";
      }
      return formatJstDate(date);
    });

    mockGetPenaltySummaryMonthly.mockResolvedValue({
      data: {
        totalPenalty: 0,
        dailyPenaltyTotal: 0,
        weeklyPenaltyTotal: 0,
        isClosed: false,
        triggeredPenaltyRuleIds: [],
        taskStatusByDate: [],
      },
    });
    mockListPenaltyRules.mockResolvedValue({ data: { items: [] } });
    mockPostTaskCompletionToggle.mockImplementation((taskId, body) =>
      Promise.resolve({
        data: {
          taskId,
          targetDate: body.targetDate,
          completed: body.action === "complete",
          weeklyCompletedCount: 0,
        },
      }),
    );
    mockGetMonthCloseCandidate.mockResolvedValue({
      data: { candidate: null, pendingMonthCount: 0 },
    });
    mockPostMonthClose.mockResolvedValue({ data: { status: "closed" } });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const renderPage = (initialEntry = "/summary?month=2026-02") =>
    render(
      <AppProviders>
        <MemoryRouter initialEntries={[initialEntry]}>
          <SuspenseQueryBoundary errorMessage="サマリー画面の読み込みに失敗しました。">
            <RootLayoutContext
              value={{
                currentUserId: "me",
                currentTeamId: "team",
                currentTeamName: "テスト",
                displayName: "自分",
                colorHex: "#123456",
              }}
            >
              <SummaryPage />
            </RootLayoutContext>
          </SuspenseQueryBoundary>
        </MemoryRouter>
      </AppProviders>,
    );

  it("renders summary content when queries succeed", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "月次サマリー" })).toBeInTheDocument();
    });
    expect(screen.getByText("発動ペナルティはありません。")).toBeInTheDocument();
  });

  it("confirms the candidate period before manually closing a month", async () => {
    mockGetMonthCloseCandidate.mockResolvedValue({
      data: {
        candidate: {
          month: "2026-02",
          dailyThroughDate: "2026-02-28",
          weeklyThroughDate: "2026-02-22",
        },
        pendingMonthCount: 1,
      },
    });
    renderPage("/summary?month=2026-02&close=1");

    expect(await screen.findByText(/月またぎ週は終了日を含む月へ計上/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "再計算して締める" }));
    await waitFor(() => {
      expect(mockPostMonthClose).toHaveBeenCalledWith("2026-02");
    });
  });

  it("shows boundary error when summary query fails", async () => {
    await withExpectedConsoleError(async () => {
      mockGetPenaltySummaryMonthly.mockRejectedValue(new Error("request failed: 500"));
      renderPage();

      await waitFor(
        () => {
          expect(screen.getByText("サマリー画面の読み込みに失敗しました。")).toBeInTheDocument();
        },
        { timeout: 4_000 },
      );
      expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
    });
  });

  it("renders the empty state for valid empty summary arrays", async () => {
    mockGetPenaltySummaryMonthly.mockResolvedValue({
      data: {
        totalPenalty: 0,
        dailyPenaltyTotal: 0,
        weeklyPenaltyTotal: 0,
        isClosed: false,
        triggeredPenaltyRuleIds: [],
        taskStatusByDate: [],
      },
    });
    mockListPenaltyRules.mockResolvedValue({ data: { items: [] } });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "月次サマリー" })).toBeInTheDocument();
    });
    expect(screen.getByText("発動ペナルティはありません。")).toBeInTheDocument();
  });

  it("immediately applies past daily and weekly changes without confirmation or a countdown", async () => {
    const month = "2026-03";
    const yesterdayKey = dateStringInJST(new Date("2026-03-16T00:00:00+09:00"));
    const todayKey = dateStringInJST(new Date("2026-03-17T00:00:00+09:00"));
    const pastWeekKey = dateStringInJST(new Date("2026-03-09T00:00:00+09:00"));

    mockGetPenaltySummaryMonthly.mockResolvedValue({
      data: {
        totalPenalty: 2,
        dailyPenaltyTotal: 2,
        weeklyPenaltyTotal: 0,
        isClosed: false,
        triggeredPenaltyRuleIds: [],
        taskStatusByDate: [
          {
            date: yesterdayKey,
            items: [
              {
                taskId: "daily-past",
                title: "皿洗い",
                type: "daily",
                penaltyPoints: 2,
                completed: false,
                isDeleted: false,
                completionSlots: [{ slot: 1 }],
              },
              {
                taskId: "daily-past-completed",
                title: "片付け",
                type: "daily",
                penaltyPoints: 2,
                completed: true,
                isDeleted: false,
                completionSlots: [
                  {
                    slot: 1,
                    actor: {
                      userId: "user-daily",
                      effectiveName: "花子",
                      colorHex: "#228B22",
                    },
                  },
                ],
              },
            ],
          },
          {
            date: pastWeekKey,
            items: [
              {
                taskId: "weekly-past",
                title: "掃除",
                type: "weekly",
                penaltyPoints: 2,
                completed: false,
                isDeleted: false,
                completionSlots: [
                  {
                    slot: 1,
                    actor: {
                      userId: "user-weekly-partial",
                      effectiveName: "次郎",
                      colorHex: "#9932CC",
                    },
                  },
                  { slot: 2 },
                  { slot: 3 },
                ],
              },
              {
                taskId: "weekly-past-completed",
                title: "ToDo",
                type: "weekly",
                penaltyPoints: 2,
                completed: true,
                isDeleted: false,
                completionSlots: [
                  {
                    slot: 1,
                    actor: {
                      userId: "user-weekly",
                      effectiveName: "太郎",
                      colorHex: "#1E90FF",
                    },
                  },
                  {
                    slot: 2,
                    actor: {
                      userId: "user-weekly-2",
                      effectiveName: "次郎",
                      colorHex: "#9932CC",
                    },
                  },
                  {
                    slot: 3,
                    actor: {
                      userId: "user-weekly-3",
                      effectiveName: "三郎",
                      colorHex: "#DC143C",
                    },
                  },
                ],
              },
            ],
          },
          {
            date: todayKey,
            items: [
              {
                taskId: "daily-today",
                title: "洗濯",
                type: "daily",
                penaltyPoints: 2,
                completed: false,
                isDeleted: false,
                completionSlots: [{ slot: 1 }],
              },
            ],
          },
        ],
      },
    });

    renderPage(`/summary?month=${month}`);

    expect(
      await screen.findByRole("button", { name: "過去日タスクを完了にする" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "過去日タスクを完了にする" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "過去日タスクを未完了に戻す" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /回目:/ })).toHaveLength(6);
    expect(screen.getByRole("button", { name: "2回目: 未完了: 1回追加" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1回目: 太郎: 1回取り消す" })).toBeInTheDocument();
    expect(screen.getAllByTestId("completion-slot-empty-check")).toHaveLength(2);
    expect(screen.getByRole("img", { name: "1回目: 花子" })).toBeInTheDocument();

    vi.useFakeTimers();
    for (const [label, taskId, targetDate, action] of [
      ["過去日タスクを完了にする", "daily-past", yesterdayKey, "complete"],
      ["2回目: 未完了: 1回追加", "weekly-past", pastWeekKey, "increment"],
      ["過去日タスクを未完了に戻す", "daily-past-completed", yesterdayKey, "incomplete"],
      ["1回目: 太郎: 1回取り消す", "weekly-past-completed", pastWeekKey, "decrement"],
    ]) {
      const callsBefore = mockPostTaskCompletionToggle.mock.calls.length;
      await act(async () => {
        const button = screen.getByRole("button", { name: label });
        fireEvent.click(button);
        // Single-state operations reject duplicates before the pending UI renders.
        if (taskId.startsWith("daily")) fireEvent.click(button);
      });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "変更を取り消す" })).not.toBeInTheDocument();
      expect(screen.queryByRole("img", { name: /変更まで/ })).not.toBeInTheDocument();
      // No timer advancement: each click must send its request immediately.
      expect(mockPostTaskCompletionToggle).toHaveBeenLastCalledWith(taskId, { targetDate, action });
      expect(mockPostTaskCompletionToggle).toHaveBeenCalledTimes(callsBefore + 1);
      await act(async () => vi.advanceTimersByTimeAsync(1));
    }
  });

  it("keeps dates independent and restores controls after a failed request", async () => {
    mockGetPenaltySummaryMonthly.mockResolvedValue({
      data: {
        totalPenalty: 0,
        dailyPenaltyTotal: 0,
        weeklyPenaltyTotal: 0,
        isClosed: false,
        triggeredPenaltyRuleIds: [],
        taskStatusByDate: ["2026-03-15", "2026-03-16"].map((date) => ({
          date,
          items: [
            {
              taskId: "same-task",
              title: date,
              type: "daily",
              penaltyPoints: 1,
              completed: false,
              isDeleted: false,
              completionSlots: [{ slot: 1 }],
            },
          ],
        })),
      },
    });
    let reject!: (error: Error) => void;
    mockPostTaskCompletionToggle.mockImplementationOnce(
      () =>
        new Promise((_, no) => {
          reject = no;
        }),
    );
    renderPage("/summary?month=2026-03");
    const firstRow = (await screen.findByText("2026-03-15")).closest("li")!;
    const secondRow = screen.getByText("2026-03-16").closest("li")!;
    await userEvent.click(
      within(secondRow).getByRole("button", { name: "過去日タスクを完了にする" }),
    );
    expect(mockPostTaskCompletionToggle).toHaveBeenCalledExactlyOnceWith("same-task", {
      targetDate: "2026-03-16",
      action: "complete",
    });
    expect(within(secondRow).queryByText("保存中…")).not.toBeInTheDocument();
    expect(within(secondRow).getByText("完了", { exact: true })).toBeVisible();
    expect(within(secondRow).getByRole("button")).toHaveAttribute("aria-disabled", "true");
    expect(
      within(firstRow).getByRole("button", { name: "過去日タスクを完了にする" }),
    ).toBeEnabled();
    await userEvent.click(
      within(firstRow).getByRole("button", { name: "過去日タスクを完了にする" }),
    );
    expect(mockPostTaskCompletionToggle).toHaveBeenLastCalledWith("same-task", {
      targetDate: "2026-03-15",
      action: "complete",
    });
    expect(mockPostTaskCompletionToggle).toHaveBeenCalledTimes(2);
    await act(async () => {
      reject(new Error("offline"));
    });
    expect(await screen.findByText("更新失敗: 通信エラー")).toBeVisible();
    await waitFor(() =>
      expect(
        within(secondRow).getByRole("button", { name: "過去日タスクを完了にする" }),
      ).toHaveAttribute("aria-disabled", "false"),
    );
  });

  it("allows a closed past month correction with a recalculation warning", async () => {
    mockGetPenaltySummaryMonthly.mockResolvedValue({
      data: {
        totalPenalty: 2,
        dailyPenaltyTotal: 2,
        weeklyPenaltyTotal: 0,
        isClosed: true,
        triggeredPenaltyRuleIds: [],
        taskStatusByDate: [
          {
            date: "2026-03-16",
            items: [
              {
                taskId: "daily-past",
                title: "皿洗い",
                type: "daily",
                penaltyPoints: 2,
                completed: false,
                isDeleted: false,
                completionSlots: [{ slot: 1 }],
              },
            ],
          },
          {
            date: "2026-03-17",
            items: [
              {
                taskId: "daily-today",
                title: "洗濯",
                type: "daily",
                penaltyPoints: 2,
                completed: false,
                isDeleted: false,
                completionSlots: [{ slot: 1 }],
              },
            ],
          },
        ],
      },
    });

    renderPage("/summary?month=2026-03");

    await screen.findByRole("heading", { name: "月次サマリー" });
    await userEvent.click(screen.getByRole("button", { name: "過去日タスクを完了にする" }));
    expect(await screen.findByText(/操作対象外を含め、現在設定で月全体/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "変更を取り消す" })).not.toBeInTheDocument();
    expect(mockPostTaskCompletionToggle).toHaveBeenCalledExactlyOnceWith("daily-past", {
      targetDate: "2026-03-16",
      action: "complete",
    });
  });
});
