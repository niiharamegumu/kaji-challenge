import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

const mockPostAuth = vi.fn();
const mockGetHome = vi.fn();
const mockListTasks = vi.fn();
const mockListRules = vi.fn();
const mockSummary = vi.fn();
const mockGetMe = vi.fn();
const mockPostTask = vi.fn();

vi.mock("./lib/api/generated/client", () => ({
  TaskType: { daily: "daily", weekly: "weekly" },
  postAuthOidcGoogleCallback: (...args: unknown[]) => mockPostAuth(...args),
  getHome: (...args: unknown[]) => mockGetHome(...args),
  listTasks: (...args: unknown[]) => mockListTasks(...args),
  listPenaltyRules: (...args: unknown[]) => mockListRules(...args),
  getPenaltySummaryMonthly: (...args: unknown[]) => mockSummary(...args),
  getMe: (...args: unknown[]) => mockGetMe(...args),
  postTask: (...args: unknown[]) => mockPostTask(...args),
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
  beforeEach(() => {
    window.localStorage.clear();
    mockPostAuth.mockReset();
    mockGetHome.mockReset();
    mockListTasks.mockReset();
    mockListRules.mockReset();
    mockSummary.mockReset();
    mockGetMe.mockReset();
    mockPostTask.mockReset();

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
    mockGetMe.mockResolvedValue({ data: { user: { displayName: "Owner" } } });
    mockPostTask.mockResolvedValue({ data: {} });
  });

  it("renders login form before authentication", () => {
    render(<App />);

    expect(screen.getByText("家事チャレ MVP")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ログイン" }),
    ).toBeInTheDocument();
  });

  it("shows error message when login returns 404", async () => {
    mockPostAuth.mockRejectedValue(new Error("request failed: 404"));
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getAllByRole("button", { name: "ログイン" })[0]);

    expect(
      await screen.findByText(/ログインに失敗しました/),
    ).toBeInTheDocument();
    expect(screen.getByText(/404/)).toBeInTheDocument();
  });

  it("can login and render dashboard", async () => {
    mockPostAuth.mockResolvedValue({
      data: { accessToken: "token-1", user: { displayName: "Owner" } },
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getAllByRole("button", { name: "ログイン" })[0]);

    expect(await screen.findByText("家事チャレ")).toBeInTheDocument();
    expect(screen.getByText("ホーム")).toBeInTheDocument();
  });

  it("posts task from admin tab", async () => {
    window.localStorage.setItem("kaji.accessToken", "token-1");
    const user = userEvent.setup();
    render(<App />);

    const adminButtons = await screen.findAllByRole("button", { name: "管理" });
    await user.click(adminButtons[0]);
    await user.click(screen.getAllByRole("button", { name: "タスク追加" })[0]);

    expect(mockPostTask).toHaveBeenCalled();
    const firstArg = mockPostTask.mock.calls[0]?.[0];
    expect(firstArg).toMatchObject({
      title: "皿洗い",
      type: "daily",
      penaltyPoints: 2,
    });
  });
});
