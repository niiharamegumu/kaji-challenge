import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useHomePageQueries } from "./useHomeQueries";

const mockGetTaskOverview = vi.fn();
const mockListTodoItems = vi.fn();
const mockGetPenaltySummaryMonthly = vi.fn();
const mockListPenaltyRules = vi.fn();

vi.mock("../../../lib/api/operations", async () => {
  const actual = await vi.importActual<object>("../../../lib/api/operations");
  return {
    ...actual,
    getTaskOverview: (...args: unknown[]) => mockGetTaskOverview(...args),
    listTodoItems: (...args: unknown[]) => mockListTodoItems(...args),
    getPenaltySummaryMonthly: (...args: unknown[]) => mockGetPenaltySummaryMonthly(...args),
    listPenaltyRules: (...args: unknown[]) => mockListPenaltyRules(...args),
  };
});

vi.mock("../../../shared/utils/dates", async () => {
  const actual = await vi.importActual<object>("../../../shared/utils/dates");
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

function QueryProbe({ onRender }: { onRender?: () => void }) {
  const {
    homeQuery,
    todoItemsQuery,
    previousMonth,
    previousMonthPenaltySummaryQuery,
    penaltyRulesQuery,
  } = useHomePageQueries();
  onRender?.();
  return (
    <div>
      {homeQuery.isSuccess ? "home-ready" : "home-pending"}:{todoItemsQuery.data.length}:
      {previousMonth}:{previousMonthPenaltySummaryQuery.data.totalPenalty}:
      {penaltyRulesQuery.data?.length ?? 0}
    </div>
  );
}

describe("useHomePageQueries", () => {
  beforeEach(() => {
    mockGetTaskOverview.mockReset();
    mockListTodoItems.mockReset();
    mockGetPenaltySummaryMonthly.mockReset();
    mockListPenaltyRules.mockReset();
  });

  it("starts all home requests in parallel", async () => {
    const home = deferred<{ data: Record<string, never> }>();
    const todo = deferred<{ data: { items: never[] } }>();
    const summary = deferred<{ data: { totalPenalty: number } }>();
    const rules = deferred<{ data: { items: never[] } }>();
    mockGetTaskOverview.mockReturnValue(home.promise);
    mockListTodoItems.mockReturnValue(todo.promise);
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
      expect(mockListTodoItems).toHaveBeenCalledOnce();
      expect(mockGetPenaltySummaryMonthly).toHaveBeenCalledOnce();
      expect(mockGetPenaltySummaryMonthly).toHaveBeenCalledWith(
        {
          month: "2026-07",
        },
        { signal: expect.any(AbortSignal) },
      );
      expect(mockListPenaltyRules).toHaveBeenCalledOnce();
    });

    home.resolve({ data: {} });
    todo.resolve({ data: { items: [] } });
    summary.resolve({ data: { totalPenalty: 3 } });
    rules.resolve({ data: { items: [] } });
    expect(await screen.findByText("home-ready:0:2026-07:3:0")).toBeInTheDocument();
  });

  it("does not rerender the page when background refetches return unchanged data", async () => {
    mockGetTaskOverview.mockResolvedValue({ data: {} });
    mockListTodoItems.mockResolvedValue({ data: { items: [] } });
    mockGetPenaltySummaryMonthly.mockResolvedValue({ data: { totalPenalty: 3 } });
    mockListPenaltyRules.mockResolvedValue({ data: { items: [] } });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const onRender = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={<div>loading</div>}>
          <QueryProbe onRender={onRender} />
        </Suspense>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("home-ready:0:2026-07:3:0")).toBeInTheDocument();
    const initialRenders = onRender.mock.calls.length;
    await act(async () => {
      await queryClient.refetchQueries();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mockGetTaskOverview).toHaveBeenCalledTimes(2);
    expect(mockListTodoItems).toHaveBeenCalledTimes(2);
    expect(onRender).toHaveBeenCalledTimes(initialRenders);
  });
});
