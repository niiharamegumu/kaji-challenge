import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { appQueryClient } from "./shared/query/queryClient";
import { queryKeys } from "./shared/query/queryKeys";
import { withExpectedConsoleError } from "./test/console";

const mockGetAuthStart = vi.fn();
const mockGetTaskOverview = vi.fn();
const mockListTasks = vi.fn();
const mockListRules = vi.fn();
const mockSummary = vi.fn();
const mockGetMe = vi.fn();
const mockGetTeamCurrentMembers = vi.fn();
const mockGetTeamCurrentInvite = vi.fn();
const mockPostTeamInvite = vi.fn();
const mockListShoppingItems = vi.fn();
const mockPrefetchHomeData = vi.fn();
const mockPreloadAdminTasksPageChunk = vi.fn();
const mockPreloadAdminPenaltiesPageChunk = vi.fn();
const mockPreloadAdminInvitesPageChunk = vi.fn();
const mockPreloadAdminSummaryPageChunk = vi.fn();
const mockPreloadReminderCalendarPageChunk = vi.fn();
const mockPreloadShoppingListPageChunk = vi.fn();

vi.mock("./lib/api/generated/client", () => ({
  TaskType: { daily: "daily", weekly: "weekly" },
  ReminderKind: { one_time: "one_time", recurring: "recurring" },
  ReminderScheduleType: {
    daily: "daily",
    weekly: "weekly",
    monthly: "monthly",
  },
  getAuthGoogleStart: (...args: unknown[]) => mockGetAuthStart(...args),
  postAuthSessionsExchange: vi.fn(),
  postAuthLogout: vi.fn(),
  getTaskOverview: (...args: unknown[]) => mockGetTaskOverview(...args),
  listTasks: (...args: unknown[]) => mockListTasks(...args),
  listPenaltyRules: (...args: unknown[]) => mockListRules(...args),
  getPenaltySummaryMonthly: (...args: unknown[]) => mockSummary(...args),
  getMe: (...args: unknown[]) => mockGetMe(...args),
  getTeamCurrentMembers: (...args: unknown[]) =>
    mockGetTeamCurrentMembers(...args),
  getTeamCurrentInvite: (...args: unknown[]) =>
    mockGetTeamCurrentInvite(...args),
  listShoppingItems: (...args: unknown[]) => mockListShoppingItems(...args),
  listReminders: vi.fn(),
  listReminderDefinitions: vi.fn(),
  postReminder: vi.fn(),
  patchReminder: vi.fn(),
  deleteReminder: vi.fn(),
  postShoppingItem: vi.fn(),
  patchShoppingItem: vi.fn(),
  deleteShoppingItem: vi.fn(),
  postShoppingItemsReorder: vi.fn(),
  postTasksReorder: vi.fn(),
  postTask: vi.fn(),
  postTaskCompletionToggle: vi.fn(),
  patchTask: vi.fn(),
  deleteTask: vi.fn(),
  postPenaltyRule: vi.fn(),
  patchPenaltyRule: vi.fn(),
  deletePenaltyRule: vi.fn(),
  postTeamInvite: (...args: unknown[]) => mockPostTeamInvite(...args),
  postTeamJoin: vi.fn(),
}));

vi.mock("./features/home/preload", () => ({
  prefetchHomeData: (...args: unknown[]) => mockPrefetchHomeData(...args),
}));

vi.mock("./app/route-chunks", () => ({
  AdminTasksPage: () => <div>tasks page</div>,
  AdminPenaltiesPage: () => <div>penalties page</div>,
  AdminInvitesPage: () => <div>settings page</div>,
  AdminSummaryPage: () => <div>summary page</div>,
  ReminderCalendarPage: () => <div>calendar page</div>,
  ShoppingListPage: () => <div>shopping page</div>,
  preloadAdminTasksPageChunk: (...args: unknown[]) =>
    mockPreloadAdminTasksPageChunk(...args),
  preloadAdminPenaltiesPageChunk: (...args: unknown[]) =>
    mockPreloadAdminPenaltiesPageChunk(...args),
  preloadAdminInvitesPageChunk: (...args: unknown[]) =>
    mockPreloadAdminInvitesPageChunk(...args),
  preloadAdminSummaryPageChunk: (...args: unknown[]) =>
    mockPreloadAdminSummaryPageChunk(...args),
  preloadReminderCalendarPageChunk: (...args: unknown[]) =>
    mockPreloadReminderCalendarPageChunk(...args),
  preloadShoppingListPageChunk: (...args: unknown[]) =>
    mockPreloadShoppingListPageChunk(...args),
}));

describe("App", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.localStorage.clear();
    window.history.pushState({}, "", "/");
    appQueryClient.clear();

    mockGetAuthStart.mockReset();
    mockGetTaskOverview.mockReset();
    mockListTasks.mockReset();
    mockListRules.mockReset();
    mockSummary.mockReset();
    mockGetMe.mockReset();
    mockGetTeamCurrentMembers.mockReset();
    mockGetTeamCurrentInvite.mockReset();
    mockPostTeamInvite.mockReset();
    mockListShoppingItems.mockReset();
    mockPrefetchHomeData.mockReset();
    mockPreloadAdminTasksPageChunk.mockReset();
    mockPreloadAdminPenaltiesPageChunk.mockReset();
    mockPreloadAdminInvitesPageChunk.mockReset();
    mockPreloadAdminSummaryPageChunk.mockReset();
    mockPreloadReminderCalendarPageChunk.mockReset();
    mockPreloadShoppingListPageChunk.mockReset();

    mockGetTaskOverview.mockResolvedValue({
      data: {
        month: "2026-02",
        today: "2026-02-15",
        elapsedDaysInWeek: 2,
        monthlyPenaltyTotal: 0,
        dailyTasks: [],
        weeklyTasks: [],
        weeklyReminders: [],
      },
    });
    mockListTasks.mockResolvedValue({ data: { items: [] } });
    mockListRules.mockResolvedValue({ data: { items: [] } });
    mockSummary.mockResolvedValue({ data: { totalPenalty: 0 } });
    mockGetTeamCurrentMembers.mockResolvedValue({ data: { items: [] } });
    mockGetTeamCurrentInvite.mockResolvedValue({ data: null });
    mockListShoppingItems.mockResolvedValue({ data: { items: [] } });
    mockPostTeamInvite.mockResolvedValue({
      data: {
        code: "NEWCODE",
        expiresAt: "2026-02-28T00:00:00Z",
        teamId: "team-1",
      },
    });
    mockPrefetchHomeData.mockResolvedValue(undefined);
    mockPreloadAdminTasksPageChunk.mockResolvedValue(undefined);
    mockPreloadAdminPenaltiesPageChunk.mockResolvedValue(undefined);
    mockPreloadAdminInvitesPageChunk.mockResolvedValue(undefined);
    mockPreloadAdminSummaryPageChunk.mockResolvedValue(undefined);
    mockPreloadReminderCalendarPageChunk.mockResolvedValue(undefined);
    mockPreloadShoppingListPageChunk.mockResolvedValue(undefined);
    mockGetMe.mockRejectedValue(new Error("request failed: 401"));
  });

  it("renders login before authentication", async () => {
    render(<App />);

    expect(
      screen.getAllByRole("status", { name: "読み込み中" }).length,
    ).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.getByText("KajiChalle")).toBeInTheDocument();
      expect(
        screen.getByText(
          /家事を見える化して、分担と継続をチームで支えるサービスです。/,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("img", { name: "KajiChalleのアプリアイコン" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Googleでログイン" }),
      ).toBeInTheDocument();
    });
  });

  it("shows error message when auth start returns 404", async () => {
    mockGetAuthStart.mockRejectedValue(new Error("request failed: 404"));
    const user = userEvent.setup();

    render(<App />);

    const loginButton = await screen.findByRole("button", {
      name: "Googleでログイン",
    });
    await user.click(loginButton);

    expect(
      await screen.findByText(/ログイン開始に失敗しました/),
    ).toBeInTheDocument();
    expect(screen.getByText(/404/)).toBeInTheDocument();
  });

  it("shows navigation after authentication", async () => {
    mockGetMe.mockResolvedValue({
      data: { user: { id: "u1", displayName: "Owner" }, memberships: [] },
    });
    const user = userEvent.setup();
    render(<App />);

    const primaryNav = within(
      await screen.findByTestId("floating-nav-primary"),
    );
    const floatingNav = within(await screen.findByTestId("floating-nav"));

    await waitFor(() => {
      expect(
        primaryNav.getByRole("button", { name: "ホーム" }),
      ).toBeInTheDocument();
      expect(
        primaryNav.getByRole("button", { name: "買い物" }),
      ).toBeInTheDocument();
      expect(
        primaryNav.getByRole("button", { name: "カレンダー" }),
      ).toBeInTheDocument();
      expect(
        primaryNav.getByRole("button", { name: "サマリー" }),
      ).toBeInTheDocument();
      expect(
        floatingNav.getByRole("button", { name: "その他" }),
      ).toBeInTheDocument();
    });

    await user.click(floatingNav.getByRole("button", { name: "その他" }));

    expect(screen.getByRole("button", { name: "タスク" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "設定" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ログアウト" }),
    ).toBeInTheDocument();
  });

  it("shows the home shell while task overview is still loading", async () => {
    mockGetMe.mockResolvedValue({
      data: { user: { id: "u1", displayName: "Owner" }, memberships: [] },
    });
    mockGetTaskOverview.mockImplementation(() => new Promise(() => {}));

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "チーム" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("status", { name: "ホームを読み込み中" }),
      ).toBeInTheDocument();
    });
  });

  it("shows shopping list panel on home after authentication", async () => {
    mockGetMe.mockResolvedValue({
      data: { user: { id: "u1", displayName: "Owner" }, memberships: [] },
    });

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "買い物リスト" }),
      ).toBeInTheDocument();
    });
  });

  it("shows previous-month penalties to handle this month", async () => {
    mockGetMe.mockResolvedValue({
      data: { user: { id: "u1", displayName: "Owner" }, memberships: [] },
    });
    mockSummary.mockResolvedValue({
      data: {
        totalPenalty: 5,
        triggeredPenaltyRuleIds: ["rule-1"],
      },
    });
    mockListRules.mockResolvedValue({
      data: {
        items: [
          {
            id: "rule-1",
            teamId: "team-1",
            name: "おやつ抜き",
            threshold: 5,
            createdAt: "2026-08-01T00:00:00Z",
            updatedAt: "2026-08-01T00:00:00Z",
          },
        ],
      },
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: "今月のペナルティ",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("おやつ抜き")).toBeInTheDocument();
    expect(screen.getByText("発動しきい値: 5")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "前月サマリー" }),
    ).toBeInTheDocument();
  });

  it("keeps logged-out state when getMe returns 401", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText("KajiChalle").length).toBeGreaterThan(0);
      expect(
        screen.getAllByRole("button", { name: "Googleでログイン" }).length,
      ).toBeGreaterThan(0);
    });
  });

  it("uses cached me data without immediate refetch", async () => {
    window.history.pushState({}, "", "/admin");
    appQueryClient.setQueryData(queryKeys.me, {
      user: { id: "u1", displayName: "Owner" },
      memberships: [{ teamName: "Team A" }],
    });
    mockGetMe.mockRejectedValue(new Error("request failed: 401"));

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "ホーム" }),
      ).toBeInTheDocument();
    });
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("renders task notes on home", async () => {
    mockGetMe.mockResolvedValue({
      data: { user: { id: "u1", displayName: "Owner" }, memberships: [] },
    });
    mockGetTaskOverview.mockResolvedValue({
      data: {
        month: "2026-02",
        today: "2026-02-15",
        elapsedDaysInWeek: 2,
        monthlyPenaltyTotal: 0,
        dailyTasks: [
          {
            task: {
              id: "task-1",
              teamId: "team-1",
              title: "皿洗い",
              notes: "夜ごはんの後に実施",
              type: "daily",
              penaltyPoints: 2,
              assigneeUserId: undefined,
              requiredCompletionsPerWeek: 1,
              createdAt: "2026-02-01T00:00:00Z",
              updatedAt: "2026-02-01T00:00:00Z",
            },
            completedToday: false,
          },
        ],
        weeklyTasks: [],
        weeklyReminders: [],
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("夜ごはんの後に実施")).toBeInTheDocument();
    });
    expect(mockPrefetchHomeData).toHaveBeenCalledTimes(1);
  });

  it("does not prefetch home data before authentication", async () => {
    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Googleでログイン" }),
      ).toBeInTheDocument();
    });

    expect(mockPrefetchHomeData).not.toHaveBeenCalled();
  });

  it("warms route chunks and home data after session restore outside the home route", async () => {
    const originalRequestIdleCallback = globalThis.requestIdleCallback;
    const originalCancelIdleCallback = globalThis.cancelIdleCallback;
    let idleCallback: IdleRequestCallback | undefined;

    globalThis.requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      idleCallback = callback;
      return 1;
    });
    globalThis.cancelIdleCallback = vi.fn();

    try {
      window.history.pushState({}, "", "/admin/summary");
      mockGetMe.mockResolvedValue({
        data: { user: { id: "u1", displayName: "Owner" }, memberships: [] },
      });

      render(<App />);

      await waitFor(() => {
        expect(window.location.pathname).toBe("/admin/summary");
      });

      expect(mockPrefetchHomeData).not.toHaveBeenCalled();
      expect(mockPreloadAdminTasksPageChunk).not.toHaveBeenCalled();

      await waitFor(() => {
        expect(globalThis.requestIdleCallback).toHaveBeenCalledTimes(1);
        expect(idleCallback).toBeTypeOf("function");
      });

      idleCallback?.({
        didTimeout: false,
        timeRemaining: () => 50,
      });

      await waitFor(() => {
        expect(mockPrefetchHomeData).toHaveBeenCalledTimes(1);
        expect(mockPreloadAdminTasksPageChunk).toHaveBeenCalledTimes(1);
        expect(mockPreloadAdminSummaryPageChunk).toHaveBeenCalledTimes(1);
        expect(mockPreloadAdminPenaltiesPageChunk).toHaveBeenCalledTimes(1);
        expect(mockPreloadAdminInvitesPageChunk).toHaveBeenCalledTimes(1);
        expect(mockPreloadShoppingListPageChunk).toHaveBeenCalledTimes(1);
      });
    } finally {
      globalThis.requestIdleCallback = originalRequestIdleCallback;
      globalThis.cancelIdleCallback = originalCancelIdleCallback;
    }
  });

  it("keeps current URL on reload when session is valid", async () => {
    window.history.pushState({}, "", "/admin/summary?month=2026-02");
    mockGetMe.mockResolvedValue({
      data: { user: { id: "u1", displayName: "Owner" }, memberships: [] },
    });

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/admin/summary");
      expect(window.location.search).toBe("?month=2026-02");
    });
    expect(
      screen.queryByRole("button", { name: "Googleでログイン" }),
    ).not.toBeInTheDocument();
  });

  it("shows login card on protected page when session is invalid", async () => {
    window.history.pushState({}, "", "/admin/summary");
    mockGetMe.mockRejectedValue(new Error("request failed: 401"));

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Googleでログイン" }),
      ).toBeInTheDocument();
    });
  });

  it("shows boundary error on home when task overview fetch fails", async () => {
    await withExpectedConsoleError(async () => {
      mockGetMe.mockResolvedValue({
        data: { user: { id: "u1", displayName: "Owner" }, memberships: [] },
      });
      mockGetTaskOverview.mockRejectedValue(new Error("request failed: 500"));

      render(<App />);

      await waitFor(
        () => {
          expect(
            screen.getByText("ホーム画面の読み込みに失敗しました。"),
          ).toBeInTheDocument();
        },
        { timeout: 4_000 },
      );
      expect(
        screen.getByRole("button", { name: "再試行" }),
      ).toBeInTheDocument();
    });
  });

  it("preloads route chunks when nav links receive intent", async () => {
    mockGetMe.mockResolvedValue({
      data: { user: { id: "u1", displayName: "Owner" }, memberships: [] },
    });
    const user = userEvent.setup();

    render(<App />);

    const primaryNav = within(
      await screen.findByTestId("floating-nav-primary"),
    );
    const floatingNav = within(await screen.findByTestId("floating-nav"));
    const shoppingButton = primaryNav.getByRole("button", {
      name: "買い物",
    });
    const calendarButton = primaryNav.getByRole("button", {
      name: "カレンダー",
    });
    const summaryButton = primaryNav.getByRole("button", { name: "サマリー" });
    const moreButton = floatingNav.getByRole("button", { name: "その他" });

    fireEvent.touchStart(shoppingButton);
    fireEvent.pointerEnter(calendarButton, { pointerType: "mouse" });
    fireEvent.pointerEnter(summaryButton, { pointerType: "mouse" });
    await user.click(moreButton);

    const taskButton = screen.getByRole("button", { name: "タスク" });
    fireEvent.mouseEnter(taskButton);

    expect(mockPreloadAdminTasksPageChunk).toHaveBeenCalledTimes(1);
    expect(mockPreloadReminderCalendarPageChunk).toHaveBeenCalledTimes(1);
    expect(mockPreloadAdminSummaryPageChunk).toHaveBeenCalledTimes(1);
    expect(mockPreloadShoppingListPageChunk).toHaveBeenCalledTimes(1);
  });
});
