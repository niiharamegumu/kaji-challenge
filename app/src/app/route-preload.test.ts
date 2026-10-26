import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { prefetchRouteData } from "./route-preload";
import { todoItemsQueryOptions } from "../shared/query/todoQueries";
import { queryKeys } from "../shared/query/queryKeys";

const api = vi.hoisted(() => ({
  items: vi.fn(),
  categories: vi.fn(),
  tasks: vi.fn(),
  rules: vi.fn(),
  invite: vi.fn(),
  members: vi.fn(),
  definitions: vi.fn(),
  reminders: vi.fn(),
  summary: vi.fn(),
}));
vi.mock("../lib/api/operations", async (original) => ({
  ...(await original<object>()),
  listTodoItems: api.items,
  listTodoCategories: api.categories,
  listTasks: api.tasks,
  listPenaltyRules: api.rules,
  getTeamCurrentInvite: api.invite,
  getTeamCurrentMembers: api.members,
  listReminderDefinitions: api.definitions,
  listReminders: api.reminders,
  getPenaltySummaryMonthly: api.summary,
}));
afterEach(() => vi.resetAllMocks());
const makeClient = () =>
  new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });

it.each(["/tasks", "/penalties", "/settings", "/calendar"])(
  "starts %s data immediately without waiting for page code",
  async (path) => {
    const client = makeClient();
    api.tasks.mockResolvedValue({ data: { items: [] } });
    api.rules.mockResolvedValue({ data: { items: [] } });
    api.invite.mockResolvedValue({ data: null });
    api.members.mockResolvedValue({ data: { items: [] } });
    api.definitions.mockResolvedValue({ data: { items: [] } });
    api.reminders.mockResolvedValue({ data: { days: [] } });
    const loading = prefetchRouteData(client, path);
    const expected =
      path === "/tasks"
        ? [api.tasks]
        : path === "/penalties"
          ? [api.rules]
          : path === "/settings"
            ? [api.members, api.invite]
            : [api.definitions, api.reminders];
    for (const request of expected) expect(request).toHaveBeenCalledTimes(1);
    await loading;
    client.clear();
  },
);

it("prefetches the requested summary month and future calendar month", async () => {
  const client = makeClient();
  api.summary.mockResolvedValue({ data: {} });
  api.rules.mockResolvedValue({ data: { items: [] } });
  api.definitions.mockResolvedValue({ data: { items: [] } });
  api.reminders.mockResolvedValue({ data: { days: [] } });
  await prefetchRouteData(client, "/summary?month=2025-02&close=1");
  expect(api.summary).toHaveBeenCalledWith({ month: "2025-02" }, expect.anything());
  await prefetchRouteData(client, "/calendar?date=2098-03-12");
  expect(api.reminders).toHaveBeenCalledWith(
    { from: "2098-03-01", to: "2098-03-31" },
    expect.anything(),
  );
  client.clear();
});

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

it.each(["logout", "team change"])(
  "aborts in-flight intent data after %s without restoring the old cache",
  async (change) => {
    const client = makeClient();
    const me = { user: { id: "user-1" }, memberships: [{ teamId: "team-1" }] };
    client.setQueryData(queryKeys.me, me);
    let finish!: (value: unknown) => void;
    api.tasks
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      )
      .mockResolvedValue({ data: { items: [] } });

    const loading = prefetchRouteData(client, "/tasks");
    expect(api.tasks).toHaveBeenCalledTimes(1);
    const signal = api.tasks.mock.calls[0][1].signal as AbortSignal;
    await client.cancelQueries({ queryKey: queryKeys.tasks });
    client.removeQueries({ queryKey: queryKeys.tasks });
    if (change === "logout") {
      client.clear();
    } else {
      client.setQueryData(queryKeys.me, { ...me, memberships: [{ teamId: "team-2" }] });
    }
    expect(signal.aborted).toBe(true);
    finish({ data: { items: [{ id: "old-team" }] } });
    await loading;

    expect(api.tasks).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(queryKeys.tasks)).toBeUndefined();

    if (change === "logout") client.setQueryData(queryKeys.me, me);
    await prefetchRouteData(client, "/tasks");
    expect(api.tasks).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(queryKeys.tasks)).toEqual([]);
    client.clear();
  },
);
