import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { prefetchRouteData } from "./route-preload";
import { todoItemsQueryOptions } from "../shared/query/todoQueries";
import { queryKeys } from "../shared/query/queryKeys";

const api = vi.hoisted(() => ({ items: vi.fn(), categories: vi.fn() }));
vi.mock("../lib/api/operations", async (original) => ({
  ...(await original<object>()),
  listTodoItems: api.items,
  listTodoCategories: api.categories,
}));
afterEach(() => vi.resetAllMocks());
const makeClient = () =>
  new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });

it("starts both requests before the page loads and shares in-flight and fresh cache data", async () => {
  const client = makeClient();
  let finish!: (value: unknown) => void;
  api.items.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  api.categories.mockResolvedValue({ data: { categories: [null] } });
  const first = prefetchRouteData(client, "/todos");
  const second = prefetchRouteData(client, "/todos");
  expect(api.items).toHaveBeenCalledTimes(1);
  expect(api.categories).toHaveBeenCalledTimes(1);
  finish({ data: { items: [] } });
  await Promise.all([first, second]);
  await prefetchRouteData(client, "/todos");
  expect(await client.fetchQuery(todoItemsQueryOptions)).toEqual([]);
  expect(api.items).toHaveBeenCalledTimes(1);
  expect(api.categories).toHaveBeenCalledTimes(1);
  client.clear();
});

it("allows retry after a failed prefetch instead of keeping a rejected promise", async () => {
  const client = makeClient();
  api.items
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ data: { items: [] } });
  api.categories.mockResolvedValue({ data: { categories: [null] } });
  await expect(prefetchRouteData(client, "/todos")).resolves.toBeUndefined();
  await prefetchRouteData(client, "/todos");
  expect(api.items).toHaveBeenCalledTimes(2);
  expect(client.getQueryData(queryKeys.todoItems)).toEqual([]);
  client.clear();
});

it("passes abort signals so canceled team requests cannot populate prefetched caches", async () => {
  const client = makeClient();
  let finish!: (value: unknown) => void;
  api.items.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  api.categories.mockResolvedValue({ data: { categories: [null] } });
  const loading = prefetchRouteData(client, "/todos");
  const signal = api.items.mock.calls[0][0].signal as AbortSignal;
  await client.cancelQueries({ queryKey: queryKeys.todoItems });
  expect(signal.aborted).toBe(true);
  client.removeQueries({ queryKey: queryKeys.todoItems });
  finish({ data: { items: [{ id: "old-team" }] } });
  await loading;
  expect(client.getQueryData(queryKeys.todoItems)).toBeUndefined();
  client.clear();
});
