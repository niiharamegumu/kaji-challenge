import { QueryClient, QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MonthlyPenaltySummary, TaskCompletionResponse } from "../../../lib/api/operations";
import { queryKeys } from "../../../shared/query/queryKeys";
import { PastTaskCompletionControl } from "../components/PastTaskCompletionControl";
import { usePastTaskCompletion } from "./usePastTaskCompletion";

const api = vi.hoisted(() => ({ save: vi.fn(), load: vi.fn() }));
vi.mock("../api/summaryApi", () => ({ updatePastTaskCompletion: api.save }));
const actor = { userId: "me", effectiveName: "自分", colorHex: "#123456" };
const other = { userId: "other", effectiveName: "別の人", colorHex: "#654321" };
const month = "2026-03";
const key = [...queryKeys.monthlySummary, month];
function deferred() {
  let resolve!: (data: { data: TaskCompletionResponse }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ data: TaskCompletionResponse }>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(): MonthlyPenaltySummary {
  return {
    month,
    teamId: "team",
    totalPenalty: 0,
    dailyPenaltyTotal: 0,
    weeklyPenaltyTotal: 0,
    isClosed: false,
    triggeredPenaltyRuleIds: [],
    taskStatusByDate: ["2026-03-09", "2026-03-02"].map((date) => ({
      date,
      items: [
        {
          taskId: "daily",
          title: "日間",
          type: "daily",
          penaltyPoints: 1,
          completed: false,
          isDeleted: false,
          completionSlots: [{ slot: 1 }],
        },
        {
          taskId: "weekly",
          title: "週間",
          type: "weekly",
          penaltyPoints: 1,
          completed: false,
          isDeleted: false,
          completionSlots: [{ slot: 1 }, { slot: 2 }, { slot: 3 }],
        },
        {
          taskId: "once",
          title: "週1回",
          type: "weekly",
          penaltyPoints: 1,
          completed: false,
          isDeleted: false,
          completionSlots: [{ slot: 1 }],
        },
      ],
    })),
  };
}
function Probe({
  status,
  selectedMonth = month,
}: {
  status: (message: string) => void;
  selectedMonth?: string;
}) {
  const { data } = useSuspenseQuery({
    queryKey: [...queryKeys.monthlySummary, selectedMonth],
    queryFn: api.load,
  });
  const completion = usePastTaskCompletion(selectedMonth, data, actor, status);
  return (
    <>
      {completion.data.taskStatusByDate.map((group) =>
        group.items.map((item) => (
          <section key={`${group.date}:${item.taskId}`} aria-label={`${group.date}:${item.taskId}`}>
            <p>{item.completed ? "完了" : "未完了"}</p>
            <PastTaskCompletionControl
              item={item}
              targetDate={group.date}
              isSaving={completion.isSaving({
                taskId: item.taskId,
                type: item.type,
                targetDate: group.date,
              })}
              onUpdate={completion.update}
            />
          </section>
        )),
      )}
    </>
  );
}
function setup(data = fixture()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(key, data);
  const status = vi.fn();
  const wrap = (selectedMonth = month) => (
    <QueryClientProvider client={client}>
      <Probe key={selectedMonth} status={status} selectedMonth={selectedMonth} />
    </QueryClientProvider>
  );
  const view = render(wrap());
  return {
    client,
    status,
    user: userEvent.setup(),
    rerender: (selectedMonth: string) => view.rerender(wrap(selectedMonth)),
  };
}
const row = (id: string, date = "2026-03-09") =>
  within(screen.getByRole("region", { name: `${date}:${id}` }));
const response = (
  taskId: string,
  count: number,
  completed: boolean,
  targetDate = "2026-03-09",
) => ({ data: { taskId, targetDate, completed, weeklyCompletedCount: count } });

beforeEach(() => {
  api.save.mockReset();
  api.load.mockReset().mockReturnValue(new Promise(() => {}));
});
afterEach(cleanup);

it("previews daily completion, keeps dates independent, and rolls back only the failed operation", async () => {
  const first = deferred(),
    second = deferred();
  api.save.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { client, status, user } = setup();
  const firstButton = row("daily").getByRole("button");
  await user.click(firstButton);
  expect(row("daily").getByText("完了", { exact: true })).toBeVisible();
  expect(row("daily").getByRole("img", { name: "1回目: 自分" })).toBeVisible();
  expect(firstButton).toHaveFocus();
  expect(screen.queryByText("保存中…")).not.toBeInTheDocument();
  await user.click(firstButton);
  expect(api.save).toHaveBeenCalledTimes(1);
  await user.click(row("daily", "2026-03-02").getByRole("button"));
  expect(row("daily", "2026-03-02").getByText("完了", { exact: true })).toBeVisible();
  act(() => {
    client.setQueryData(key, fixture());
  });
  expect(row("daily").getByText("完了", { exact: true })).toBeVisible();
  expect(
    client.getQueryData<MonthlyPenaltySummary>(key)?.taskStatusByDate[0].items[0].completed,
  ).toBe(false);
  await act(async () => first.reject(new Error("offline")));
  expect(await row("daily").findByText("未完了", { exact: true })).toBeVisible();
  expect(row("daily", "2026-03-02").getByText("完了", { exact: true })).toBeVisible();
  expect(status).toHaveBeenCalledWith("更新失敗: 通信エラー");
  await act(async () => second.resolve(response("daily", 0, true, "2026-03-02")));
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(row("daily", "2026-03-02").getByText("完了", { exact: true })).toBeVisible();
});

it.each(["daily", "once"])(
  "previews %s reversal, restores the previous actor on failure, and uses explicit state requests",
  async (id) => {
    const data = fixture();
    const item = data.taskStatusByDate[0].items.find((entry) => entry.taskId === id)!;
    item.completed = true;
    item.completionSlots[0].actor = other;
    const saved = deferred();
    api.save.mockReturnValue(saved.promise);
    const { user } = setup(data);
    await user.click(row(id).getByRole("button"));
    expect(row(id).getByText("未完了", { exact: true })).toBeVisible();
    expect(api.save).toHaveBeenCalledExactlyOnceWith(id, {
      targetDate: "2026-03-09",
      action: "incomplete",
    });
    await user.click(row(id).getByRole("button"));
    expect(api.save).toHaveBeenCalledTimes(1);
    await act(async () => saved.reject(new Error("offline")));
    expect(await row(id).findByText("完了", { exact: true })).toBeVisible();
    expect(
      row(id).getByRole(id === "daily" ? "img" : "button", {
        name: id === "daily" ? "1回目: 別の人" : "1回目: 別の人: 1回取り消す",
      }),
    ).toBeVisible();
  },
);

it("accepts three weekly taps before any response and preserves the count through reversed responses", async () => {
  const responses = [deferred(), deferred(), deferred()];
  for (const saved of responses) api.save.mockReturnValueOnce(saved.promise);
  const { client, user } = setup();
  for (const slot of [1, 2, 3]) {
    await user.click(row("weekly").getByRole("button", { name: `${slot}回目: 未完了: 1回追加` }));
    expect(
      row("weekly").getByRole("button", { name: `${slot}回目: 自分: 1回取り消す` }),
    ).toHaveAttribute("aria-disabled", "false");
  }
  expect(api.save).toHaveBeenCalledTimes(3);
  expect(row("weekly").getByText("完了", { exact: true })).toBeVisible();
  expect(screen.queryByText("保存中…")).not.toBeInTheDocument();
  act(() => {
    client.setQueryData(key, fixture());
  });
  for (const index of [2, 0, 1]) {
    await act(async () => responses[index].resolve(response("weekly", index + 1, index === 2)));
    expect(row("weekly").getByText("完了", { exact: true })).toBeVisible();
  }
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(
    client.getQueryData<MonthlyPenaltySummary>(key)?.taskStatusByDate[0].items[1].completed,
  ).toBe(true);
  await waitFor(() => expect(api.load).toHaveBeenCalledTimes(1));
});

it("keeps the other member and the successful weekly increment when one of two additions fails", async () => {
  const data = fixture();
  data.taskStatusByDate[0].items[1].completionSlots[0].actor = other;
  const first = deferred(),
    second = deferred();
  api.save.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { client, user } = setup(data);
  await user.click(row("weekly").getByRole("button", { name: "2回目: 未完了: 1回追加" }));
  await user.click(row("weekly").getByRole("button", { name: "3回目: 未完了: 1回追加" }));
  await act(async () => second.resolve(response("weekly", 3, true)));
  expect(row("weekly").getByText("完了", { exact: true })).toBeVisible();
  await act(async () => first.reject(new Error("offline")));
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(row("weekly").getByRole("button", { name: "1回目: 別の人: 1回取り消す" })).toBeVisible();
  expect(row("weekly").getByRole("button", { name: "2回目: 自分: 1回取り消す" })).toBeVisible();
  expect(row("weekly").getByRole("button", { name: "3回目: 未完了: 1回追加" })).toBeVisible();
});

it("bounds rapid weekly additions and deletions even before the next render", async () => {
  const responses = Array.from({ length: 6 }, () => deferred());
  for (const saved of responses) api.save.mockReturnValueOnce(saved.promise);
  const { client } = setup();
  const add = row("weekly").getByRole("button", { name: "1回目: 未完了: 1回追加" });
  act(() => {
    for (let i = 0; i < 4; i++) fireEvent.click(add);
  });
  await waitFor(() => expect(api.save).toHaveBeenCalledTimes(3));
  for (let i = 0; i < 3; i++)
    await act(async () => responses[i].resolve(response("weekly", i + 1, i === 2)));
  await waitFor(() => expect(client.isMutating()).toBe(0));
  const remove = row("weekly").getByRole("button", { name: "3回目: 自分: 1回取り消す" });
  act(() => {
    for (let i = 0; i < 4; i++) fireEvent.click(remove);
  });
  await waitFor(() => expect(api.save).toHaveBeenCalledTimes(6));
  expect(row("weekly").getByText("未完了", { exact: true })).toBeVisible();
  for (let i = 5; i >= 3; i--)
    await act(async () => responses[i].resolve(response("weekly", 5 - i, false)));
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(row("weekly").getAllByRole("button", { name: /未完了: 1回追加/ })).toHaveLength(3);
});

it("retains pending display across months and writes the response to its original month", async () => {
  const saved = deferred();
  api.save.mockReturnValue(saved.promise);
  const { client, user, rerender } = setup();
  client.setQueryData([...queryKeys.monthlySummary, "2026-04"], {
    ...fixture(),
    month: "2026-04",
    taskStatusByDate: [],
  });
  await user.click(row("daily").getByRole("button"));
  rerender("2026-04");
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
  rerender(month);
  expect(row("daily").getByText("完了", { exact: true })).toBeVisible();
  rerender("2026-04");
  await act(async () => saved.resolve(response("daily", 0, true)));
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(
    client.getQueryData<MonthlyPenaltySummary>(key)?.taskStatusByDate[0].items[0].completed,
  ).toBe(true);
  expect(
    client.getQueryData<MonthlyPenaltySummary>([...queryKeys.monthlySummary, "2026-04"])
      ?.taskStatusByDate,
  ).toEqual([]);
});
