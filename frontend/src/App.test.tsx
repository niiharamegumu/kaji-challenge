import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { appQueryClient } from "./shared/query/queryClient";

const mockGetAuthStart = vi.fn();
const mockGetHome = vi.fn();
const mockListTasks = vi.fn();
const mockListRules = vi.fn();
const mockSummary = vi.fn();
const mockGetMe = vi.fn();

vi.mock("./lib/api/generated/client", () => ({
  TaskType: { daily: "daily", weekly: "weekly" },
  getAuthGoogleStart: (...args: unknown[]) => mockGetAuthStart(...args),
  postAuthSessionsExchange: vi.fn(),
  postAuthLogout: vi.fn(),
  getHome: (...args: unknown[]) => mockGetHome(...args),
  listTasks: (...args: unknown[]) => mockListTasks(...args),
  listPenaltyRules: (...args: unknown[]) => mockListRules(...args),
  getPenaltySummaryMonthly: (...args: unknown[]) => mockSummary(...args),
  getMe: (...args: unknown[]) => mockGetMe(...args),
  postTask: vi.fn(),
  postTaskCompletionToggle: vi.fn(),
  patchTask: vi.fn(),
  deleteTask: vi.fn(),
  postPenaltyRule: vi.fn(),
  patchPenaltyRule: vi.fn(),
  deletePenaltyRule: vi.fn(),
  postTeamInvite: vi.fn(),
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
    mockGetHome.mockReset();
    mockListTasks.mockReset();
    mockListRules.mockReset();
    mockSummary.mockReset();
    mockGetMe.mockReset();

    mockGetHome.mockResolvedValue({
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
    mockGetMe.mockRejectedValue(new Error("request failed: 401"));
  });

  it("renders login before authentication", () => {
    render(<App />);

    expect(screen.getByText("家事チャレ MVP")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Googleでログイン" }),
    ).toBeInTheDocument();
  });

  it("shows error message when auth start returns 404", async () => {
    mockGetAuthStart.mockRejectedValue(new Error("request failed: 404"));
    const user = userEvent.setup();

    render(<App />);

    const loginButtons = screen.getAllByRole("button", {
      name: "Googleでログイン",
    });
    await user.click(loginButtons[0]);

    expect(
      await screen.findByText(/ログイン開始に失敗しました/),
    ).toBeInTheDocument();
    expect(screen.getByText(/404/)).toBeInTheDocument();
  });

  it("shows navigation after authentication", async () => {
    mockGetMe.mockResolvedValue({ data: { user: { displayName: "Owner" } } });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "ホーム" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "管理" })).toBeInTheDocument();
    });
  });

  it("keeps logged-out state when getMe returns 401", () => {
    render(<App />);

    expect(screen.getAllByText("家事チャレ MVP").length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "Googleでログイン" }).length,
    ).toBeGreaterThan(0);
  });
});
