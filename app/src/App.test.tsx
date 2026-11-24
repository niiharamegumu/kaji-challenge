import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AppShell from "./App";
import { clearPWARefresh, notifyPWARefresh } from "./app/pwa";
import { useSuspenseQuery } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { lazy, useState } from "react";
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
    signOut: (...args: unknown[]) => mockSignOut(...args),
  },
}));
import { appQueryClient } from "./shared/query/queryClient";
import { queryKeys } from "./shared/query/queryKeys";
import { tasksQueryOptions } from "./shared/query/taskQueries";
import { withExpectedConsoleError } from "./test/console";

const mockGetAuthStart = vi.fn();
const mockSignOut = vi.fn();
const mockGetTaskOverview = vi.fn();
const mockListTasks = vi.fn();
const mockListRules = vi.fn();
const mockSummary = vi.fn();
const mockGetMe = vi.fn();
const mockGetTeamCurrentMembers = vi.fn();
const mockGetTeamCurrentInvite = vi.fn();
const mockPostTeamInvite = vi.fn();
const mockPrefetchHomeData = vi.fn();
const mockPreloadTasksPageChunk = vi.fn();
const mockPreloadPenaltiesPageChunk = vi.fn();
const mockPreloadSettingsPageChunk = vi.fn();
const mockPreloadSummaryPageChunk = vi.fn();
const mockPreloadReminderCalendarPageChunk = vi.fn();
const mockTasksPage = vi.fn();

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
  listReminders: vi.fn(),
  listReminderDefinitions: vi.fn(),
  postReminder: vi.fn(),
  patchReminder: vi.fn(),
  deleteReminder: vi.fn(),
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
  TasksPage: () => mockTasksPage(),
  PenaltiesPage: () => <div>penalties page</div>,
  SettingsPage: () => <div>settings page</div>,
  SummaryPage: () => <div>summary page</div>,
  ReminderCalendarPage: () => <div>calendar page</div>,
  preloadTasksPageChunk: (...args: unknown[]) => mockPreloadTasksPageChunk(...args),
  preloadPenaltiesPageChunk: (...args: unknown[]) => mockPreloadPenaltiesPageChunk(...args),
  preloadSettingsPageChunk: (...args: unknown[]) => mockPreloadSettingsPageChunk(...args),
  preloadSummaryPageChunk: (...args: unknown[]) => mockPreloadSummaryPageChunk(...args),
  preloadReminderCalendarPageChunk: (...args: unknown[]) =>
    mockPreloadReminderCalendarPageChunk(...args),
}));

describe("App", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    clearPWARefresh();
    window.localStorage.clear();
    window.history.pushState({}, "", "/");
    appQueryClient.clear();

    mockGetAuthStart.mockReset();
    mockSignOut.mockReset().mockResolvedValue({});
    mockGetTaskOverview.mockReset();
    mockListTasks.mockReset();
    mockListRules.mockReset();
    mockSummary.mockReset();
    mockGetMe.mockReset();
    mockGetTeamCurrentMembers.mockReset();
    mockGetTeamCurrentInvite.mockReset();
    mockPostTeamInvite.mockReset();
    mockPrefetchHomeData.mockReset();
    mockPreloadTasksPageChunk.mockReset();
    mockPreloadPenaltiesPageChunk.mockReset();
    mockPreloadSettingsPageChunk.mockReset();
    mockPreloadSummaryPageChunk.mockReset();
    mockPreloadReminderCalendarPageChunk.mockReset();
    mockTasksPage.mockReset();
    mockTasksPage.mockImplementation(() => <div>tasks page</div>);

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
    mockGetMe.mockRejectedValue(new Error("request failed: 401"));
  });

  it("renders login before authentication", async () => {
    render(<App />);

    expect((await screen.findAllByRole("status", { name: "読み込み中" })).length).toBeGreaterThan(
      0,
    );

    await waitFor(() => {
      expect(screen.getByText("KajiChalle")).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "KajiChalleのアプリアイコン" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Googleでログイン" })).toBeInTheDocument();
      expect(screen.queryAllByTestId("boot-screen")).toHaveLength(0);
    });
  });

  it("clears retired preferences and page drafts while preserving unrelated storage", async () => {
    const retiredKeys = [
      "kaji:todo-completion-delay-ms:v1",
      "kaji:legacy-preferences-owner:v1",
      "kaji:todo-default-category:v1:user-1:team-1",
      "kaji:user-preferences:v1:user-1",
      "kaji:user-preferences:v1:user-2",
    ];
    for (const key of retiredKeys) window.localStorage.setItem(key, "legacy");
    window.localStorage.setItem("kaji:theme:v1", "dark");
    const draftKeys = ["kaji:shared-page-draft:v1:u1:t1:new", "kaji:shared-page-draft:v1:u2:t2:p"];
    for (const key of draftKeys) window.sessionStorage.setItem(key, "draft");
    window.sessionStorage.setItem("other", "keep");

    render(<App />);
    await screen.findByRole("button", { name: "Googleでログイン" });

    for (const key of retiredKeys) expect(window.localStorage.getItem(key)).toBeNull();
    expect(window.localStorage.getItem("kaji:theme:v1")).toBe("dark");
    for (const key of draftKeys) expect(window.sessionStorage.getItem(key)).toBeNull();
    expect(window.sessionStorage.getItem("other")).toBe("keep");
    window.sessionStorage.removeItem("other");
  });

  it("shows progress while preparing an update and allows retry after failure", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "Googleでログイン" });
    let fail!: (error: Error) => void;
    const update = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        }),
    );
    act(() => notifyPWARefresh(update));
    fireEvent.click(screen.getByRole("button", { name: "更新する" }));
    const progress = screen.getByRole("status");
    expect(progress).toHaveTextContent("更新を準備しています");
    expect(within(progress).queryByRole("button")).not.toBeInTheDocument();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await act(async () => fail(new Error("offline")));
    expect(screen.getByRole("status")).toHaveTextContent("更新を適用できませんでした");
    const retry = vi.fn(async () => {});
    act(() => notifyPWARefresh(retry));
    fireEvent.click(screen.getByRole("button", { name: "更新する" }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
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
      expect(primaryNav.getAllByRole("button")).toHaveLength(2);
      expect(primaryNav.queryByRole("button", { name: "カレンダー" })).not.toBeInTheDocument();
      expect(floatingNav.queryByRole("button", { name: "アシスト" })).not.toBeInTheDocument();
      expect(primaryNav.getByRole("button", { name: "サマリー" })).toBeInTheDocument();
      expect(floatingNav.getByRole("button", { name: "その他" })).toBeInTheDocument();
      expect(screen.queryAllByTestId("boot-screen")).toHaveLength(0);
    });

    await user.click(floatingNav.getByRole("button", { name: "その他" }));

    expect(screen.getByRole("button", { name: "カレンダー" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "共有ページ" })).not.toBeInTheDocument();
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

  it("shows weekly reminders on home after authentication", async () => {
    mockGetMe.mockResolvedValue({
      data: { user: { id: "u1", displayName: "Owner" }, memberships: [] },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "今週のリマインダー" })).toBeInTheDocument();
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

  it("starts the current route data after authentication without waiting for page code", async () => {
    window.history.pushState({}, "", "/tasks");
    function LoadedTasksPage() {
      const tasks = useSuspenseQuery(tasksQueryOptions);
      return <div>loaded tasks: {tasks.data.length}</div>;
    }
    let finishPageLoad!: (module: { default: typeof LoadedTasksPage }) => void;
    const loadPage = vi.fn(
      () =>
        new Promise<{ default: typeof LoadedTasksPage }>((resolve) => {
          finishPageLoad = resolve;
        }),
    );
    const DeferredTasksPage = lazy(loadPage);
    mockTasksPage.mockImplementation(() => <DeferredTasksPage />);
    let finishAuthentication!: (value: unknown) => void;
    mockGetMe.mockReturnValue(
      new Promise((resolve) => {
        finishAuthentication = resolve;
      }),
    );
    render(<App />);
    expect(mockListTasks).not.toHaveBeenCalled();
    expect(loadPage).not.toHaveBeenCalled();
    await act(async () => {
      finishAuthentication({ data: { user: { id: "u1", displayName: "Owner" }, memberships: [] } });
    });
    await waitFor(() => expect(mockListTasks).toHaveBeenCalledTimes(1));
    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("loaded tasks: 0")).not.toBeInTheDocument();
    expect(mockPreloadTasksPageChunk).not.toHaveBeenCalled();
    expect(mockPrefetchHomeData).not.toHaveBeenCalled();
    await act(async () => finishPageLoad({ default: LoadedTasksPage }));
    expect(await screen.findByText("loaded tasks: 0")).toBeInTheDocument();
    expect(mockListTasks).toHaveBeenCalledTimes(1);
  });

  it("uses the requested summary month for direct-route data prefetch", async () => {
    window.history.pushState({}, "", "/summary?month=2025-02");
    mockGetMe.mockResolvedValue({
      data: { user: { id: "u1", displayName: "Owner" }, memberships: [] },
    });
    render(<App />);
    await waitFor(() =>
      expect(mockSummary).toHaveBeenCalledWith({ month: "2025-02" }, expect.anything()),
    );
    expect(mockListTasks).not.toHaveBeenCalled();
    expect(mockPrefetchHomeData).not.toHaveBeenCalled();
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

  it.each(["/", "/summary"])(
    "does not warm unrelated routes after session restore on %s",
    async (path) => {
      const originalRequestIdleCallback = globalThis.requestIdleCallback;
      const originalCancelIdleCallback = globalThis.cancelIdleCallback;
      let idleCallback: IdleRequestCallback | undefined;

      globalThis.requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
        idleCallback = callback;
        return 1;
      });
      globalThis.cancelIdleCallback = vi.fn();

      try {
        window.history.pushState({}, "", path);
        mockGetMe.mockResolvedValue({
          data: { user: { id: "u1", displayName: "Owner" }, memberships: [] },
        });

        render(<App />);

        expect(await screen.findByTestId("floating-nav-primary")).toBeInTheDocument();
        expect(window.location.pathname).toBe(path);

        idleCallback?.({
          didTimeout: false,
          timeRemaining: () => 50,
        });

        expect(mockPrefetchHomeData).toHaveBeenCalledTimes(path === "/" ? 1 : 0);
        expect(mockPreloadTasksPageChunk).not.toHaveBeenCalled();
        expect(mockPreloadSummaryPageChunk).not.toHaveBeenCalled();
        expect(mockPreloadPenaltiesPageChunk).not.toHaveBeenCalled();
        expect(mockPreloadSettingsPageChunk).not.toHaveBeenCalled();
        expect(mockPreloadReminderCalendarPageChunk).not.toHaveBeenCalled();
        expect(globalThis.requestIdleCallback).not.toHaveBeenCalled();
      } finally {
        globalThis.requestIdleCallback = originalRequestIdleCallback;
        globalThis.cancelIdleCallback = originalCancelIdleCallback;
      }
    },
  );

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
    const summaryButton = primaryNav.getByRole("button", { name: "サマリー" });
    const moreButton = floatingNav.getByRole("button", { name: "その他" });

    fireEvent.touchStart(summaryButton);
    await user.click(moreButton);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "カレンダー" }));

    const taskButton = screen.getByRole("button", { name: "タスク" });
    fireEvent.mouseEnter(taskButton);

    expect(mockPreloadTasksPageChunk).toHaveBeenCalledTimes(1);
    expect(mockPreloadReminderCalendarPageChunk).toHaveBeenCalledTimes(1);
    expect(mockPreloadSummaryPageChunk).toHaveBeenCalledTimes(1);
  });

  it("retries failed chunk preloads on the next intent and still navigates", async () => {
    mockGetMe.mockResolvedValue({
      data: { user: { id: "u1", displayName: "Owner" }, memberships: [] },
    });
    mockPreloadSummaryPageChunk.mockRejectedValueOnce(new Error("offline"));
    render(<App />);

    const primaryNav = within(await screen.findByTestId("floating-nav-primary"));
    const summaryButton = primaryNav.getByRole("button", { name: "サマリー" });
    fireEvent.touchStart(summaryButton);
    await waitFor(() => expect(mockPreloadSummaryPageChunk).toHaveBeenCalledTimes(1));

    fireEvent.pointerEnter(summaryButton, { pointerType: "mouse" });
    expect(mockPreloadSummaryPageChunk).toHaveBeenCalledTimes(2);
    fireEvent.click(summaryButton);

    expect(await screen.findByText("summary page")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/summary");
  });
});
