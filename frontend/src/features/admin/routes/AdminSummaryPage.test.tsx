import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppProviders } from "../../../app/providers";
import { SuspenseQueryBoundary } from "../../../shared/components/SuspenseQueryBoundary";
import { appQueryClient } from "../../../shared/query/queryClient";
import { dateStringInJST } from "../../../shared/utils/errors";
import { withExpectedConsoleError } from "../../../test/console";
import { AdminSummaryPage } from "./AdminSummaryPage";

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

vi.mock("../../../lib/api/generated/client", async () => {
  const actual = await vi.importActual<object>(
    "../../../lib/api/generated/client",
  );
  return {
    ...actual,
    getPenaltySummaryMonthly: (...args: unknown[]) =>
      mockGetPenaltySummaryMonthly(...args),
    listPenaltyRules: (...args: unknown[]) => mockListPenaltyRules(...args),
    postTaskCompletionToggle: (...args: unknown[]) =>
      mockPostTaskCompletionToggle(...args),
    getAdminMonthCloseCandidate: (...args: unknown[]) =>
      mockGetMonthCloseCandidate(...args),
    postAdminMonthClose: (...args: unknown[]) => mockPostMonthClose(...args),
  };
});

vi.mock("../../../shared/utils/errors", async () => {
  const actual = await vi.importActual<object>("../../../shared/utils/errors");
  return {
    ...actual,
    dateStringInJST: (...args: unknown[]) => mockDateStringInJST(...args),
  };
});

describe("AdminSummaryPage", () => {
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
    mockPostTaskCompletionToggle.mockResolvedValue({ data: {} });
    mockGetMonthCloseCandidate.mockResolvedValue({
      data: { candidate: null, pendingMonthCount: 0 },
    });
    mockPostMonthClose.mockResolvedValue({ data: { status: "closed" } });
  });

  afterEach(() => {
    cleanup();
  });

  const renderPage = (initialEntry = "/admin/summary?month=2026-02") =>
    render(
      <AppProviders>
        <MemoryRouter initialEntries={[initialEntry]}>
          <SuspenseQueryBoundary errorMessage="サマリー画面の読み込みに失敗しました。">
            <AdminSummaryPage />
          </SuspenseQueryBoundary>
        </MemoryRouter>
      </AppProviders>,
    );

  it("renders summary content when queries succeed", async () => {
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "月次サマリー" }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText("発動ペナルティはありません。"),
    ).toBeInTheDocument();
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
    renderPage("/admin/summary?month=2026-02&close=1");

    expect(
      await screen.findByText(/月またぎ週は終了日を含む月へ計上/),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "再計算して締める" }),
    );
    await waitFor(() => {
      expect(mockPostMonthClose).toHaveBeenCalledWith("2026-02");
    });
  });

  it("shows boundary error when summary query fails", async () => {
    await withExpectedConsoleError(async () => {
      mockGetPenaltySummaryMonthly.mockRejectedValue(
        new Error("request failed: 500"),
      );
      renderPage();

      await waitFor(
        () => {
          expect(
            screen.getByText("サマリー画面の読み込みに失敗しました。"),
          ).toBeInTheDocument();
        },
        { timeout: 4_000 },
      );
      expect(
        screen.getByRole("button", { name: "再試行" }),
      ).toBeInTheDocument();
    });
  });

  it("renders safely when summary arrays are null", async () => {
    mockGetPenaltySummaryMonthly.mockResolvedValue({
      data: {
        totalPenalty: 0,
        dailyPenaltyTotal: 0,
        weeklyPenaltyTotal: 0,
        isClosed: false,
        triggeredPenaltyRuleIds: null,
        taskStatusByDate: null,
      },
    });
    mockListPenaltyRules.mockResolvedValue({ data: { items: null } });

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "月次サマリー" }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText("発動ペナルティはありません。"),
    ).toBeInTheDocument();
  });

  it("shows complete action only for current-month past daily incomplete items and confirms before submit", async () => {
    const month = "2026-03";
    const yesterdayKey = dateStringInJST(new Date("2026-03-16T00:00:00+09:00"));
    const todayKey = dateStringInJST(new Date("2026-03-17T00:00:00+09:00"));
    const pastWeekKey = dateStringInJST(new Date("2026-03-09T00:00:00+09:00"));

    const user = userEvent.setup();
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
                title: "買い物",
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

    renderPage(`/admin/summary?month=${month}`);

    expect(
      await screen.findByRole("button", { name: "過去日タスクを完了にする" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "過去日タスクを完了にする" }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "過去日タスクを未完了に戻す" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /回目:/ })).toHaveLength(6);
    expect(
      screen.getByRole("button", { name: "2回目: 未完了: 1回追加" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "1回目: 太郎: 1回取り消す" }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("completion-slot-empty-check")).toHaveLength(
      2,
    );
    expect(
      screen.getByRole("img", { name: "1回目: 花子" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getAllByRole("button", { name: "過去日タスクを完了にする" })[0],
    );
    expect(
      await screen.findByText("過去日のタスクを完了に変更しますか？"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/この操作は確定後に未完了へ戻せません。/),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "完了にする" }));

    await waitFor(() => {
      expect(mockPostTaskCompletionToggle).toHaveBeenCalledWith("daily-past", {
        targetDate: yesterdayKey,
        action: "complete",
      });
    });

    await user.click(
      screen.getByRole("button", { name: "2回目: 未完了: 1回追加" }),
    );
    expect(
      await screen.findByText("過去週のタスクに1回分を追加しますか？"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "1回追加" }));
    await waitFor(() => {
      expect(mockPostTaskCompletionToggle).toHaveBeenCalledWith("weekly-past", {
        targetDate: pastWeekKey,
        action: "increment",
      });
    });

    await user.click(
      screen.getByRole("button", { name: "過去日タスクを未完了に戻す" }),
    );
    expect(
      await screen.findByText("過去日のタスクを未完了に戻しますか？"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "未完了に戻す" }));
    await waitFor(() => {
      expect(mockPostTaskCompletionToggle).toHaveBeenCalledWith(
        "daily-past-completed",
        { targetDate: yesterdayKey, action: "decrement" },
      );
    });

    await user.click(
      screen.getByRole("button", { name: "1回目: 太郎: 1回取り消す" }),
    );
    expect(
      await screen.findByText("過去週のタスクを1回分取り消しますか？"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "1回減らす" }));
    await waitFor(() => {
      expect(mockPostTaskCompletionToggle).toHaveBeenCalledWith(
        "weekly-past-completed",
        { targetDate: pastWeekKey, action: "decrement" },
      );
    });
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

    renderPage("/admin/summary?month=2026-03");

    await screen.findByRole("heading", { name: "月次サマリー" });
    await userEvent.click(
      screen.getByRole("button", { name: "過去日タスクを完了にする" }),
    );
    expect(
      await screen.findByText(/操作対象外を含め、現在設定で月全体/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "再計算して変更" }),
    ).toBeInTheDocument();
  });
});
