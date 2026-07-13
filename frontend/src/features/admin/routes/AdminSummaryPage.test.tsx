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
                completionSlots: [{ slot: 1 }],
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
      screen.getByRole("button", { name: "過去週タスクに1回追加" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "過去日タスクを未完了に戻す" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "過去週タスクを1回減らす" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "1回目: 花子" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "1回目: 太郎" }),
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
      screen.getByRole("button", { name: "過去週タスクに1回追加" }),
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
      screen.getByRole("button", { name: "過去週タスクを1回減らす" }),
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

  it("hides complete action for closed month and non-past daily items", async () => {
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
    expect(
      screen.queryByRole("button", { name: "過去日タスクを完了にする" }),
    ).not.toBeInTheDocument();
  });
});
