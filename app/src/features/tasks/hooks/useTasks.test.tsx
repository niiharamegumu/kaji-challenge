import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../../../lib/api/operations";
import { queryKeys } from "../../../shared/query/queryKeys";
import { useTaskMutations, useTasksQuery } from "./useTasks";

const api = vi.hoisted(() => ({ reorder: vi.fn(), load: vi.fn() }));
vi.mock("../../../lib/api/operations", async (original) => ({
  ...(await original<object>()),
  postTasksReorder: api.reorder,
  listTasks: api.load,
}));

const task = (id: string, type: Task["type"] = "daily"): Task => ({
  id,
  teamId: "team",
  title: id,
  type,
  penaltyPoints: 1,
  requiredCompletionsPerWeek: 1,
  sortKey: 100,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

function setup() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  const items = [task("A"), task("B"), task("W", "weekly")];
  client.setQueryData(queryKeys.tasks, items);
  api.load.mockReset().mockImplementation(() => new Promise(() => {}));
  api.reorder.mockReset();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const status = vi.fn();
  const observer = renderHook(() => useTasksQuery(), { wrapper });
  const mutations = renderHook(() => useTaskMutations(status), { wrapper });
  return { client, items, wrapper, status, observer, mutations };
}

afterEach(cleanup);

describe("task reorder feedback", () => {
  it("shares pending order after remount and restores the latest authoritative order on failure", async () => {
    const { client, items, observer, mutations, wrapper } = setup();
    let reject!: (error: Error) => void;
    api.reorder.mockImplementation(() => new Promise((_, fail) => (reject = fail)));
    expect(observer.result.current.data).toBe(client.getQueryData(queryKeys.tasks));
    act(() => mutations.result.current.reorderTasks.mutate({ taskIds: ["B", "A"] }));
    await waitFor(() =>
      expect(observer.result.current.data.map((item) => item.id)).toEqual(["B", "A", "W"]),
    );
    expect(client.getQueryData(queryKeys.tasks)).toEqual(items);
    observer.unmount();
    mutations.unmount();
    const remounted = renderHook(() => useTasksQuery(), { wrapper });
    expect(remounted.result.current.data.map((item) => item.id)).toEqual(["B", "A", "W"]);
    await act(async () => reject(new Error("offline")));
    await waitFor(() =>
      expect(remounted.result.current.data.map((item) => item.id)).toEqual(["A", "B", "W"]),
    );
    act(() => client.setQueryData(queryKeys.tasks, [items[1], items[0], items[2]]));
    await waitFor(() =>
      expect(remounted.result.current.data.map((item) => item.id)).toEqual(["B", "A", "W"]),
    );
    expect(remounted.result.current.data).toBe(client.getQueryData(queryKeys.tasks));
  });

  it("preserves additions, edits, deletions and the other task type when a stale reorder response arrives", async () => {
    const { client, items, observer, mutations } = setup();
    let resolve!: (value: unknown) => void;
    api.reorder.mockImplementation(() => new Promise((done) => (resolve = done)));
    act(() => mutations.result.current.reorderTasks.mutate({ taskIds: ["B", "A"] }));
    await waitFor(() => expect(api.reorder).toHaveBeenCalledOnce());
    const added = task("C");
    const edited = { ...items[0], title: "edited", updatedAt: "2026-01-02T00:00:00Z" };
    act(() => client.setQueryData(queryKeys.tasks, [added, edited, items[2]]));
    await act(async () => {
      resolve({
        data: {
          items: [
            { ...items[1], sortKey: 100 },
            { ...items[0], sortKey: 200 },
          ],
        },
      });
    });
    await waitFor(() => expect(mutations.result.current.reorderTasks.isPending).toBe(false));
    expect(client.getQueryData<Task[]>(queryKeys.tasks)).toEqual([
      added,
      { ...edited, sortKey: 200 },
      items[2],
    ]);
    expect(observer.result.current.data.map((item) => item.title)).toEqual(["C", "edited", "W"]);
    expect(api.load).not.toHaveBeenCalled();
  });

  it("blocks duplicate reorders before React renders and shares the pending state across hooks", async () => {
    const { mutations, wrapper } = setup();
    const second = renderHook(() => useTaskMutations(vi.fn()), { wrapper });
    let resolve!: (value: unknown) => void;
    api.reorder.mockImplementation(() => new Promise((done) => (resolve = done)));
    act(() => {
      mutations.result.current.reorderTasks.mutate({ taskIds: ["B", "A"] });
      second.result.current.reorderTasks.mutate({ taskIds: ["A", "B"] });
    });
    await waitFor(() => expect(api.reorder).toHaveBeenCalledOnce());
    expect(second.result.current.reorderTasks.isPending).toBe(true);
    await act(async () => resolve({ data: { items: [task("B"), task("A")] } }));
    await waitFor(() => expect(second.result.current.reorderTasks.isPending).toBe(false));
  });
});
