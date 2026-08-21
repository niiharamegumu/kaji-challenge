import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useHomePageQueries } from "./useHomeQueries";

const mockGetTaskOverview = vi.fn();
const mockListShoppingItems = vi.fn();
const mockGetPenaltySummaryMonthly = vi.fn();
const mockListPenaltyRules = vi.fn();

vi.mock("../../../lib/api/generated/client", async () => {
  const actual = await vi.importActual<object>(
    "../../../lib/api/generated/client",
  );
  return {
    ...actual,
    getTaskOverview: (...args: unknown[]) => mockGetTaskOverview(...args),
    listShoppingItems: (...args: unknown[]) => mockListShoppingItems(...args),
    getPenaltySummaryMonthly: (...args: unknown[]) =>
      mockGetPenaltySummaryMonthly(...args),
    listPenaltyRules: (...args: unknown[]) => mockListPenaltyRules(...args),
  };
});

vi.mock("../../../shared/utils/errors", async () => {
  const actual = await vi.importActual<object>("../../../shared/utils/errors");
  return {
    ...actual,
    dateStringInJST: () => "2026-08-21",
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function QueryProbe() {
  const {
    homeQuery,
    shoppingItemsQuery,
    previousMonth,
    previousMonthPenaltySummaryQuery,
    penaltyRulesQuery,
  } = useHomePageQueries();
  return (
    <div>
      {homeQuery.isSuccess ? "home-ready" : "home-pending"}:
      {shoppingItemsQuery.data.length}:{previousMonth}:
      {previousMonthPenaltySummaryQuery.data.totalPenalty}:
      {penaltyRulesQuery.data?.length ?? 0}
    </div>
  );
}

describe("useHomePageQueries", () => {
  beforeEach(() => {
    mockGetTaskOverview.mockReset();
    mockListShoppingItems.mockReset();
    mockGetPenaltySummaryMonthly.mockReset();
    mockListPenaltyRules.mockReset();
  });

  it("starts all home requests in parallel", async () => {
    const home = deferred<{ data: Record<string, never> }>();
    const shopping = deferred<{ data: { items: never[] } }>();
    const summary = deferred<{ data: { totalPenalty: number } }>();
    const rules = deferred<{ data: { items: never[] } }>();
    mockGetTaskOverview.mockReturnValue(home.promise);
    mockListShoppingItems.mockReturnValue(shopping.promise);
    mockGetPenaltySummaryMonthly.mockReturnValue(summary.promise);
    mockListPenaltyRules.mockReturnValue(rules.promise);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={<div>loading</div>}>
          <QueryProbe />
        </Suspense>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(mockGetTaskOverview).toHaveBeenCalledOnce();
      expect(mockListShoppingItems).toHaveBeenCalledOnce();
      expect(mockGetPenaltySummaryMonthly).toHaveBeenCalledOnce();
      expect(mockGetPenaltySummaryMonthly).toHaveBeenCalledWith({
        month: "2026-07",
      });
      expect(mockListPenaltyRules).toHaveBeenCalledOnce();
    });

    home.resolve({ data: {} });
    shopping.resolve({ data: { items: [] } });
    summary.resolve({ data: { totalPenalty: 3 } });
    rules.resolve({ data: { items: [] } });
    expect(
      await screen.findByText("home-ready:0:2026-07:3:0"),
    ).toBeInTheDocument();
  });
});
