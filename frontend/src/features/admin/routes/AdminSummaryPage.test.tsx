import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppProviders } from "../../../app/providers";
import { SuspenseQueryBoundary } from "../../../shared/components/SuspenseQueryBoundary";
import { appQueryClient } from "../../../shared/query/queryClient";
import { AdminSummaryPage } from "./AdminSummaryPage";

const mockGetPenaltySummaryMonthly = vi.fn();
const mockListPenaltyRules = vi.fn();

vi.mock("../../../lib/api/generated/client", async () => {
  const actual = await vi.importActual<object>(
    "../../../lib/api/generated/client",
  );
  return {
    ...actual,
    getPenaltySummaryMonthly: (...args: unknown[]) =>
      mockGetPenaltySummaryMonthly(...args),
    listPenaltyRules: (...args: unknown[]) => mockListPenaltyRules(...args),
  };
});

describe("AdminSummaryPage", () => {
  beforeEach(() => {
    appQueryClient.clear();
    mockGetPenaltySummaryMonthly.mockReset();
    mockListPenaltyRules.mockReset();

    mockGetPenaltySummaryMonthly.mockResolvedValue({
      data: {
        totalPenalty: 0,
        dailyPenaltyTotal: 0,
        weeklyPenaltyTotal: 0,
        triggeredPenaltyRuleIds: [],
        taskStatusByDate: [],
      },
    });
    mockListPenaltyRules.mockResolvedValue({ data: { items: [] } });
  });

  afterEach(() => {
    cleanup();
  });

  const renderPage = () =>
    render(
      <AppProviders>
        <MemoryRouter initialEntries={["/admin/summary?month=2026-02"]}>
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
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });
});
