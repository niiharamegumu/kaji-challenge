import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useHomePageQueries } from "./useHomeQueries";

const mockGetTaskOverview = vi.fn();
const mockListShoppingItems = vi.fn();

vi.mock("../../../lib/api/generated/client", async () => {
  const actual = await vi.importActual<object>(
    "../../../lib/api/generated/client",
  );
  return {
    ...actual,
    getTaskOverview: (...args: unknown[]) => mockGetTaskOverview(...args),
    listShoppingItems: (...args: unknown[]) => mockListShoppingItems(...args),
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
  const { homeQuery, shoppingItemsQuery } = useHomePageQueries();
  return (
    <div>
      {homeQuery.isSuccess ? "home-ready" : "home-pending"}:
      {shoppingItemsQuery.data.length}
    </div>
  );
}

describe("useHomePageQueries", () => {
  beforeEach(() => {
    mockGetTaskOverview.mockReset();
    mockListShoppingItems.mockReset();
  });

  it("starts the home and shopping requests in parallel", async () => {
    const home = deferred<{ data: Record<string, never> }>();
    const shopping = deferred<{ data: { items: never[] } }>();
    mockGetTaskOverview.mockReturnValue(home.promise);
    mockListShoppingItems.mockReturnValue(shopping.promise);
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
    });

    home.resolve({ data: {} });
    shopping.resolve({ data: { items: [] } });
    expect(await screen.findByText("home-ready:0")).toBeInTheDocument();
  });
});
