import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryKeys } from "../../../shared/query/queryKeys";
import { useMonthCloseCandidate } from "./useMonthCloseCandidate";

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../../lib/api/operations", () => ({ getMonthCloseCandidate: api.get }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-16T14:59:59Z"));
  api.get.mockReset().mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("shares the midnight refresh between consumers and aborts it after the last consumer leaves", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
  });
  client.setQueryData(queryKeys.monthCloseCandidate, { candidate: null, pendingMonthCount: 0 });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => {
      useMonthCloseCandidate();
      useMonthCloseCandidate();
    },
    { wrapper },
  );

  expect(api.get).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(api.get).toHaveBeenCalledTimes(1);
  const signal: AbortSignal = api.get.mock.calls[0][0].signal;
  expect(signal.aborted).toBe(false);
  hook.unmount();
  expect(signal.aborted).toBe(true);
  client.clear();
});
