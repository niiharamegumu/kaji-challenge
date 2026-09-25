import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AppShell from "./App";
import { RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import { getRouter } from "./router";
function App() {
  const [router] = useState(getRouter);
  return <RouterProvider router={router} />;
}
vi.mock("./app/document", () => ({ Document: () => <AppShell /> }));
vi.mock("./app/pwa-register", () => ({ initializePWA: vi.fn() }));
vi.mock("./features/auth/api/authClient", () => ({
  authClient: {
    signIn: { social: (...args: unknown[]) => mockGetAuthStart(...args) },
    signOut: vi.fn(),
  },
}));
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
const mockPreloadTasksPageChunk = vi.fn();
const mockPreloadPenaltiesPageChunk = vi.fn();
const mockPreloadSettingsPageChunk = vi.fn();
const mockPreloadSummaryPageChunk = vi.fn();
const mockPreloadReminderCalendarPageChunk = vi.fn();
const mockPreloadShoppingListPageChunk = vi.fn();

vi.mock("./lib/api/operations", () => ({
  TaskType: { daily: "daily", weekly: "weekly" },
  ReminderKind: { one_time: "one_time", recurring: "recurring" },
  ReminderScheduleType: {
    daily: "daily",
    weekly: "weekly",
    monthly: "monthly",
  },
  getTaskOverview: (...args: unknown[]) => mockGetTaskOverview(...args),
  listTasks: (...args: unknown[]) => mockListTasks(...args),
  listPenaltyRules: (...args: unknown[]) => mockListRules(...args),
  getPenaltySummaryMonthly: (...args: unknown[]) => mockSummary(...args),
  getMe: (...args: unknown[]) => mockGetMe(...args),
  getTeamCurrentMembers: (...args: unknown[]) => mockGetTeamCurrentMembers(...args),
  getTeamCurrentInvite: (...args: unknown[]) => mockGetTeamCurrentInvite(...args),
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
  postTaskCompletion: vi.fn(),
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
  TasksPage: () => <div>tasks page</div>,
  PenaltiesPage: () => <div>penalties page</div>,
  SettingsPage: () => <div>settings page</div>,
  SummaryPage: () => <div>summary page</div>,
  ReminderCalendarPage: () => <div>calendar page</div>,
  ShoppingListPage: () => <div>shopping page</div>,
  preloadTasksPageChunk: (...args: unknown[]) => mockPreloadTasksPageChunk(...args),
  preloadPenaltiesPageChunk: (...args: unknown[]) => mockPreloadPenaltiesPageChunk(...args),
  preloadSettingsPageChunk: (...args: unknown[]) => mockPreloadSettingsPageChunk(...args),
  preloadSummaryPageChunk: (...args: unknown[]) => mockPreloadSummaryPageChunk(...args),
  preloadReminderCalendarPageChunk: (...args: unknown[]) =>
    mockPreloadReminderCalendarPageChunk(...args),
  preloadShoppingListPageChunk: (...args: unknown[]) => mockPreloadShoppingListPageChunk(...args),
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
    mockPreloadTasksPageChunk.mockReset();
    mockPreloadPenaltiesPageChunk.mockReset();
    mockPreloadSettingsPageChunk.mockReset();
    mockPreloadSummaryPageChunk.mockReset();
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
    mockPreloadTasksPageChunk.mockResolvedValue(undefined);
    mockPreloadPenaltiesPageChunk.mockResolvedValue(undefined);
    mockPreloadSettingsPageChunk.mockResolvedValue(undefined);
    mockPreloadSummaryPageChunk.mockResolvedValue(undefined);
    mockPreloadReminderCalendarPageChunk.mockResolvedValue(undefined);
    mockPreloadShoppingListPageChunk.mockResolvedValue(undefined);
    mockGetMe.mockRejectedValue(new Error("request failed: 401"));
  });

  it("renders login before authentication", async () => {
    render(<App />);

    expect((await screen.findAllByRole("status", { name: "読み込み中" })).length).toBeGreaterThan(
      0,
    );

    await waitFor(() => {
      expect(screen.getByText("KajiChalle")).toBeInTheDocument();
      expect(
        screen.getByText(/家事を見える化して、分担と継続をチームで支えるサービスです。/),
      ).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "KajiChalleのアプリアイコン" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Googleでログイン" })).toBeInTheDocument();
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

    expect(await screen.findByText(/ログイン開始に失敗しました/)).toBeInTheDocument();
    expect(screen.getByText(/404/)).toBeInTheDocument();
  });

  it("shows navigation after authentication", async () => {
    mockGetMe.mockResolvedValue({
      data: { user: { id: "u1", displayName: "Owner" }, memberships: [] },
    });
    const user = userEvent.setup();
    render(<App />);

    const primaryNav = within(await screen.findByTestId("floating-nav-primary"));
    const floatingNav = within(await screen.findByTestId("floating-nav"));

    await waitFor(() => {
      expect(primaryNav.getByRole("button", { name: "ホーム" })).toBeInTheDocument();
      expect(primaryNav.getByRole("button", { name: "買い物" })).toBeInTheDocument();
      expect(primaryNav.getByRole("button", { name: "カレンダー" })).toBeInTheDocument();
      expect(primaryNav.getByRole("button", { name: "サマリー" })).toBeInTheDocument();
      expect(floatingNav.getByRole("button", { name: "その他" })).toBeInTheDocument();
    });

    await user.click(floatingNav.getByRole("button", { name: "その他" }));

    expect(screen.getByRole("button", { name: "タスク" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "設定" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument();
  });

  it.each([
    ["サマリー", "/summary", "summary page"],
    ["タスク", "/tasks", "tasks page"],
    ["ペナルティ", "/penalties", "penalties page"],
    ["設定", "/settings", "settings page"],
  ])("navigates from %s to %s", async (label, path, page) => {
    mockGetMe.mockResolvedValue({
      data: { user: { id: "u1", displayName: "Owner" }, memberships: [] },
    });
    const user = userEvent.setup();
    render(<App />);

    const navigation = within(await screen.findByTestId("floating-nav"));
    if (path !== "/summary") {
      await user.click(navigation.getByRole("button", { name: "その他" }));
    }
    await user.click(navigation.getByRole("button", { name: label }));

    expect(await screen.findByText(page)).toBeInTheDocument();
    expect(window.location.pathname).toBe(path);
  });

  it("shows the home shell while task overview is still loading", async () => {
    mockGetMe.mockResolvedValue({
      data: { user: { id: "u1", displayName: "Owner" }, memberships: [] },
    });
    mockGetTaskOverview.mockImplementation(() => new Promise(() => {}));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "チーム" })).toBeInTheDocument();
      expect(screen.getByRole("status", { name: "ホームを読み込み中" })).toBeInTheDocument();
    });
  });

  it("shows shopping list panel on home after authentication", async () => {
    mockGetMe.mockResolvedValue({
      data: { user: { id: "u1", displayName: "Owner" }, memberships: [] },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "買い物リスト" })).toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: "前月サマリー" })).toBeInTheDocument();
  });

  it("keeps logged-out state when getMe returns 401", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText("KajiChalle").length).toBeGreaterThan(0);
      expect(screen.getAllByRole("button", { name: "Googleでログイン" }).length).toBeGreaterThan(0);
    });
  });

  it("uses cached me data without immediate refetch", async () => {
    window.history.pushState({}, "", "/tasks");
    appQueryClient.setQueryData(queryKeys.me, {
      user: { id: "u1", displayName: "Owner" },
      memberships: [{ teamName: "Team A" }],
    });
    mockGetMe.mockRejectedValue(new Error("request failed: 401"));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "ホーム" })).toBeInTheDocument();
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
      expect(screen.getByRole("button", { name: "Googleでログイン" })).toBeInTheDocument();
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
      window.history.pushState({}, "", "/summary");
      mockGetMe.mockResolvedValue({
        data: { user: { id: "u1", displayName: "Owner" }, memberships: [] },
      });

      render(<App />);

      await waitFor(() => {
        expect(window.location.pathname).toBe("/summary");
      });

      expect(mockPrefetchHomeData).not.toHaveBeenCalled();
      expect(mockPreloadTasksPageChunk).not.toHaveBeenCalled();

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
        expect(mockPreloadTasksPageChunk).toHaveBeenCalledTimes(1);
        expect(mockPreloadSummaryPageChunk).toHaveBeenCalledTimes(1);
        expect(mockPreloadPenaltiesPageChunk).toHaveBeenCalledTimes(1);
        expect(mockPreloadSettingsPageChunk).toHaveBeenCalledTimes(1);
        expect(mockPreloadShoppingListPageChunk).toHaveBeenCalledTimes(1);
      });
    } finally {
      globalThis.requestIdleCallback = originalRequestIdleCallback;
      globalThis.cancelIdleCallback = originalCancelIdleCallback;
    }
  });

  it("keeps current URL on reload when session is valid", async () => {
    window.history.pushState({}, "", "/summary?month=2026-02");
    mockGetMe.mockResolvedValue({
      data: { user: { id: "u1", displayName: "Owner" }, memberships: [] },
    });

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/summary");
      expect(window.location.search).toBe("?month=2026-02");
    });
    expect(screen.queryByRole("button", { name: "Googleでログイン" })).not.toBeInTheDocument();
  });

  it("shows login card on protected page when session is invalid", async () => {
    window.history.pushState({}, "", "/summary");
    mockGetMe.mockRejectedValue(new Error("request failed: 401"));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Googleでログイン" })).toBeInTheDocument();
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
          expect(screen.getByText("ホーム画面の読み込みに失敗しました。")).toBeInTheDocument();
        },
        { timeout: 4_000 },
      );
      expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
    });
  });

  it("preloads route chunks when nav links receive intent", async () => {
    mockGetMe.mockResolvedValue({
      data: { user: { id: "u1", displayName: "Owner" }, memberships: [] },
    });
    const user = userEvent.setup();

    render(<App />);

    const primaryNav = within(await screen.findByTestId("floating-nav-primary"));
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

    expect(mockPreloadTasksPageChunk).toHaveBeenCalledTimes(1);
    expect(mockPreloadReminderCalendarPageChunk).toHaveBeenCalledTimes(1);
    expect(mockPreloadSummaryPageChunk).toHaveBeenCalledTimes(1);
    expect(mockPreloadShoppingListPageChunk).toHaveBeenCalledTimes(1);
  });
});
