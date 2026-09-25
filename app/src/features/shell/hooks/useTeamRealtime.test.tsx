import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PropsWithChildren } from "react";
import { useTeamRealtime } from "./useTeamRealtime";
import { queryKeys } from "../../../shared/query/queryKeys";
vi.mock("../../../lib/api/serverClient", () => ({ cancelTeamRequests: vi.fn() }));
import { cancelTeamRequests } from "../../../lib/api/serverClient";
class Socket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: Socket[] = [];
  readyState = 0;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number }) => void;
  onerror?: () => void;
  constructor() {
    Socket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
  close(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function mount() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    invalidate,
    ...renderHook(({ teamId }) => useTeamRealtime(teamId, "self"), {
      wrapper,
      initialProps: { teamId: "team" },
    }),
  };
}
it("keeps one connection across renders, clears stale presence, and reconnects with a fresh fetch", async () => {
  const hook = mount();
  act(() => {
    Socket.instances[0].open();
    Socket.instances[0].message({ type: "presence", userIds: ["self", "peer"] });
  });
  expect(hook.result.current).toMatchObject({ connected: true, userIds: ["self", "peer"] });
  hook.rerender({ teamId: "team" });
  expect(Socket.instances).toHaveLength(1);
  act(() => Socket.instances[0].close());
  expect(hook.result.current).toMatchObject({ connected: false, userIds: [] });
  hook.invalidate.mockClear();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  act(() => Socket.instances[1].open());
  expect(hook.invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.home });
  hook.unmount();
});
it("coalesces change notifications until pending mutations settle without replaying them", async () => {
  const hook = mount();
  let finish!: () => void;
  const mutationFn = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const mutation = hook.client.getMutationCache().build(hook.client, { mutationFn });
  let execution: Promise<void>;
  await act(async () => {
    execution = mutation.execute(undefined);
    await Promise.resolve();
  });
  act(() => {
    Socket.instances[0].open();
    Socket.instances[0].message({ type: "team-changed" });
    Socket.instances[0].message({ type: "team-changed" });
  });
  expect(hook.invalidate).not.toHaveBeenCalled();
  await act(async () => {
    finish();
    await execution;
  });
  expect(
    hook.invalidate.mock.calls.filter(([arg]) => arg?.queryKey === queryKeys.home),
  ).toHaveLength(1);
  expect(mutationFn).toHaveBeenCalledTimes(1);
  hook.unmount();
});
it("disposes the old team connection, requests and cache on a membership change", () => {
  const hook = mount();
  hook.client.setQueryData(queryKeys.home, { private: "old-team" });
  act(() => {
    Socket.instances[0].open();
    Socket.instances[0].message({ type: "presence", userIds: ["peer"] });
  });
  hook.rerender({ teamId: "next" });
  expect(Socket.instances[0].readyState).toBe(3);
  expect(cancelTeamRequests).toHaveBeenCalled();
  expect(hook.client.getQueryData(queryKeys.home)).toBeUndefined();
  expect(hook.result.current).toMatchObject({ connected: false, userIds: [] });
  hook.unmount();
});
it("refreshes identity on policy closure instead of repeatedly reconnecting a revoked session", async () => {
  const hook = mount();
  act(() => Socket.instances[0].close(1008));
  expect(hook.invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.me });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(Socket.instances).toHaveLength(1);
  hook.unmount();
});

it("backs off reconnects up to 30 seconds and resets the delay after connecting", async () => {
  const hook = mount();

  for (const delay of [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]) {
    const connectionCount = Socket.instances.length;
    act(() => Socket.instances.at(-1)!.close());
    await act(async () => vi.advanceTimersByTimeAsync(delay - 1));
    expect(Socket.instances).toHaveLength(connectionCount);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(Socket.instances).toHaveLength(connectionCount + 1);
  }

  act(() => {
    Socket.instances.at(-1)!.open();
    Socket.instances.at(-1)!.close();
  });
  const connectionCount = Socket.instances.length;
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(Socket.instances).toHaveLength(connectionCount + 1);
  hook.unmount();
});

it("stops retries and ignores late socket events after unmount", async () => {
  const hook = mount();
  const connection = Socket.instances[0];
  act(() => connection.close());
  hook.unmount();
  hook.invalidate.mockClear();

  await act(async () => {
    connection.open();
    connection.message({ type: "team-changed" });
    connection.close();
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(60_000);
  });

  expect(Socket.instances).toHaveLength(1);
  expect(hook.invalidate).not.toHaveBeenCalled();
});
