import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { appQueryClient } from "./shared/query/queryClient";
import { queryKeys } from "./shared/query/queryKeys";

const mockGetAuthStart = vi.fn();
const mockGetTaskOverview = vi.fn();
const mockListTasks = vi.fn();
const mockListRules = vi.fn();
const mockSummary = vi.fn();
const mockGetMe = vi.fn();
const mockGetTeamCurrentMembers = vi.fn();
const mockGetTeamCurrentInvite = vi.fn();
const mockPostTeamInvite = vi.fn();

vi.mock("./lib/api/generated/client", () => ({
  TaskType: { daily: "daily", weekly: "weekly" },
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

    mockGetTaskOverview.mockResolvedValue({
      data: {
        month: "2026-02",
        today: "2026-02-15",
        elapsedDaysInWeek: 2,
        monthlyPenaltyTotal: 0,
        dailyTasks: [],
        weeklyTasks: [],
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
    mockGetMe.mockRejectedValue(new Error("request failed: 401"));
  });

  it("renders login before authentication", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("KajiChalle")).toBeInTheDocument();
      expect(
        screen.getByText(
          /家事を見える化して、分担と継続をチームで支えるサービスです。/,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("img", { name: "KajiChalleのファビコン" }),
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

    const navOpenButton = await screen.findByRole("button", {
      name: "ナビゲーションを開く",
    });
    await user.click(navOpenButton);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "ホーム" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "タスク" })).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "サマリー" }),
      ).toBeInTheDocument();
    });
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
      expect(screen.getByRole("link", { name: "ホーム" })).toBeInTheDocument();
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
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("夜ごはんの後に実施")).toBeInTheDocument();
    });
  });
});
