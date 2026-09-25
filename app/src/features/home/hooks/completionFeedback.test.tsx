import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TaskOverviewResponse } from "../../../lib/api/operations";
import { queryKeys } from "../../../shared/query/queryKeys";
import { todayString } from "../../../shared/utils/errors";
import { previousMonthKey } from "../utils/month";
import { useHomePageQueries, useToggleCompletionMutation } from "./useHomeQueries";

const api = vi.hoisted(() => ({ save: vi.fn(), load: vi.fn() }));
vi.mock("../../../lib/api/operations", async (original) => ({
  ...(await original<object>()),
  postTaskCompletionToggle: api.save,
  getTaskOverview: api.load,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const actor = { userId: "me", effectiveName: "自分", colorHex: "#123456" };
function fixture(): TaskOverviewResponse {
  const task = (id: string, type: "daily" | "weekly") => ({
    id,
    teamId: "team",
    title: id,
    type,
    penaltyPoints: 1,
    requiredCompletionsPerWeek: type === "weekly" ? 3 : 1,
    sortKey: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  return {
    today: todayString(),
    month: todayString().slice(0, 7),
    elapsedDaysInWeek: 3,
    monthlyPenaltyTotal: 0,
    dailyTasks: ["A", "B"].map((id) => ({ task: task(id, "daily"), completedToday: false })),
    weeklyTasks: [
      {
        task: task("W", "weekly"),
        weekCompletedCount: 1,
        requiredCompletionsPerWeek: 3,
        completionSlots: [
          { slot: 1, actor: { userId: "other", effectiveName: "別の人" } },
          { slot: 2 },
          { slot: 3 },
        ],
      },
    ],
    weeklyReminders: [],
  };
}
function Probe({ status }: { status: (message: string) => void }) {
  const { homeQuery } = useHomePageQueries();
  const mutation = useToggleCompletionMutation(status, actor);
  return (
    <>
      {homeQuery.data.dailyTasks.map((item) => (
        <button
          key={item.task.id}
          onClick={() => mutation.toggle({ taskId: item.task.id, action: "toggle" })}
        >
          {item.task.id}:{item.completedToday ? "完了" : "未完了"}
        </button>
      ))}
      <output>{homeQuery.data.weeklyTasks[0].weekCompletedCount}/3</output>
      <output>
        {homeQuery.data.weeklyTasks[0].completionSlots
          .map((slot) => slot.actor?.effectiveName ?? "空")
          .join(",")}
      </output>
      <button onClick={() => mutation.toggle({ taskId: "W", action: "increment" })}>増やす</button>
      <button onClick={() => mutation.toggle({ taskId: "W", action: "decrement" })}>減らす</button>
    </>
  );
}
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(queryKeys.home, fixture());
  client.setQueryData(queryKeys.shoppingItems, []);
  client.setQueryData([...queryKeys.rules, "withDeleted"], []);
  client.setQueryData([...queryKeys.monthlySummary, previousMonthKey(todayString().slice(0, 7))], {
    totalPenalty: 0,
  });
  const status = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <Suspense fallback="loading">
        <Probe status={status} />
      </Suspense>
    </QueryClientProvider>,
  );
  return { client, status, user: userEvent.setup() };
}
beforeEach(() => {
  api.save.mockReset();
  api.load.mockReset().mockReturnValue(new Promise(() => {}));
});

it("shows completion before the response, rejects duplicate taps, and keeps other pending changes on failure", async () => {
  const a = deferred<never>(),
    b = deferred<never>();
  api.save.mockImplementation((id: string) => (id === "A" ? a.promise : b.promise));
  const { client, status, user } = setup();
  await user.click(await screen.findByRole("button", { name: "A:未完了" }));
  expect(await screen.findByRole("button", { name: "A:完了" })).toBeVisible();
  expect(
    client.getQueryData<TaskOverviewResponse>(queryKeys.home)?.dailyTasks[0].completedToday,
  ).toBe(false);
  await user.click(screen.getByRole("button", { name: "A:完了" }));
  expect(api.save).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "B:未完了" }));
  expect(await screen.findByRole("button", { name: "B:完了" })).toBeVisible();
  // 古い再取得結果が届いても、未確定の表示は消えない。
  act(() => {
    client.setQueryData(queryKeys.home, fixture());
  });
  expect(screen.getByRole("button", { name: "A:完了" })).toBeVisible();
  await act(async () => {
    a.reject(new Error("offline"));
  });
  expect(await screen.findByRole("button", { name: "A:未完了" })).toBeVisible();
  expect(screen.getByRole("button", { name: "B:完了" })).toBeVisible();
  expect(status).toHaveBeenCalledWith(expect.stringContaining("更新失敗"));
  await act(async () => {
    b.reject(new Error("offline"));
  });
});

it("keeps confirmed completion without waiting for the home refetch", async () => {
  const saved = deferred<{
    data: { taskId: string; targetDate: string; completed: boolean; weeklyCompletedCount: number };
  }>();
  api.save.mockReturnValue(saved.promise);
  const { client, user } = setup();
  await user.click(await screen.findByRole("button", { name: "A:未完了" }));
  await act(async () => {
    saved.resolve({
      data: { taskId: "A", targetDate: todayString(), completed: true, weeklyCompletedCount: 0 },
    });
  });
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(screen.getByRole("button", { name: "A:完了" })).toBeVisible();
  expect(
    client.getQueryData<TaskOverviewResponse>(queryKeys.home)?.dailyTasks[0].completedBy,
  ).toEqual(actor);
});

it("previews weekly increment and decrement while preserving the other member's slot", async () => {
  const saved = deferred<never>();
  api.save.mockReturnValue(saved.promise);
  const { user } = setup();
  await user.click(await screen.findByRole("button", { name: "増やす" }));
  expect(await screen.findByText("2/3")).toBeVisible();
  expect(screen.getByText("別の人,自分,空")).toBeVisible();
  await act(async () => {
    saved.reject(new Error("offline"));
  });
  expect(await screen.findByText("1/3")).toBeVisible();
  const removed = deferred<never>();
  api.save.mockReturnValue(removed.promise);
  await user.click(screen.getByRole("button", { name: "減らす" }));
  expect(await screen.findByText("0/3")).toBeVisible();
  await act(async () => {
    removed.reject(new Error("offline"));
  });
  expect(await screen.findByText("別の人,空,空")).toBeVisible();
});

afterEach(cleanup);
