import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MonthCloseBanner } from "./MonthCloseBanner";

const mockUseMonthCloseCandidate = vi.fn();

vi.mock("../hooks/useMonthCloseCandidate", () => ({
  useMonthCloseCandidate: () => mockUseMonthCloseCandidate(),
}));

describe("MonthCloseBanner", () => {
  beforeEach(() => {
    mockUseMonthCloseCandidate.mockReset();
  });

  it("shows the oldest pending month and remaining count", () => {
    mockUseMonthCloseCandidate.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        candidate: {
          month: "2026-01",
          dailyThroughDate: "2026-01-31",
          weeklyThroughDate: "2026-01-25",
        },
        pendingMonthCount: 3,
      },
    });

    render(
      <MemoryRouter>
        <MonthCloseBanner />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("2026年1月の月次締めが必要です"),
    ).toBeInTheDocument();
    expect(screen.getByText(/ほか2か月/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "サマリーで確認" }),
    ).toBeInTheDocument();
  });

  it("keeps the page usable and retries after a fetch error", async () => {
    const refetch = vi.fn();
    mockUseMonthCloseCandidate.mockReturnValue({
      isPending: false,
      isError: true,
      refetch,
    });

    render(
      <MemoryRouter>
        <MonthCloseBanner />
      </MemoryRouter>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "月次締め状態を再取得" }),
    );
    expect(refetch).toHaveBeenCalledOnce();
  });
});
