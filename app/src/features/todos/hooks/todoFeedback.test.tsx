import {
  categoryOrderFixture as order,
  categoryIdFixture as cid,
} from "../../../test/todoCategories";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { TodoItem } from "../../../lib/api/operations";
import { queryKeys } from "../../../shared/query/queryKeys";
import { MutationFeedback } from "../../../shared/components/MutationFeedback";
import { useTodoItemMutations, useTodoItemsQuery } from "./useTodoList";
import { useTodoCategoriesQuery } from "./useTodoCategories";

const api = vi.hoisted(() => ({
  remove: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  load: vi.fn(),
  categories: vi.fn(),
}));
vi.mock("../../../lib/api/operations", async (original) => ({
  ...(await original<object>()),
  deleteTodoItem: api.remove,
  patchTodoItem: api.update,
  listTodoItems: api.load,
  listTodoCategories: api.categories,
  postTodoItem: api.create,
}));
function Probe({ status }: { status: (message: string) => void }) {
  const { data } = useTodoItemsQuery();
  useTodoCategoriesQuery();
  const { removeItem, updateItem, createItem } = useTodoItemMutations(status);
  return (
    <>
      {data.map((item) => (
        <button key={item.id} onClick={() => removeItem.mutate(item.id)}>
          {item.name}
        </button>
      ))}
      <button onClick={() => updateItem.mutate({ itemId: "A", payload: { name: "更新済み" } })}>
        編集を保存
      </button>
      <button onClick={() => createItem.mutate({ name: "追加済み" })}>新規保存</button>
      <MutationFeedback />
    </>
  );
}
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  const items: TodoItem[] = ["A", "B"].map((id) => ({
    id,
    name: id,
    categoryId: null,
    teamId: "team",
    sortKey: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  }));
  client.setQueryData(queryKeys.todoItems, items);
  client.setQueryData(queryKeys.todoCategories, order(null, "登録済み"));
  api.load.mockReset().mockReturnValue(new Promise(() => {}));
  api.categories
    .mockReset()
    .mockResolvedValue({ data: { categories: order(null, "登録済み", "新規") } });
  const status = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <Probe status={status} />
    </QueryClientProvider>,
  );
  return { client, status, items, user: userEvent.setup() };
}

it("hides completed items before the response and restores only the failed item", async () => {
  let rejectA!: (error: Error) => void;
  let resolveB!: (data: unknown) => void;
  api.remove.mockImplementation((id: string) =>
    id === "A"
      ? new Promise((_, reject) => {
          rejectA = reject;
        })
      : new Promise((resolve) => {
          resolveB = resolve;
        }),
  );
  const { client, user, status } = setup();
  await user.click(screen.getByRole("button", { name: "A" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "A" })).not.toBeInTheDocument());
  expect(screen.getByText("保存中…")).toBeVisible();
  expect(client.getQueryData<TodoItem[]>(queryKeys.todoItems)).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "B" }));
  await act(async () => {
    resolveB({ data: {} });
  });
  await act(async () => {
    rejectA(new Error("offline"));
  });
  expect(await screen.findByRole("button", { name: "A" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "B" })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText("保存中…")).not.toBeInTheDocument());
  expect(status).toHaveBeenCalledWith(expect.stringContaining("失敗"));
});

it("uses the saved response for edits without another list request", async () => {
  const { items, user } = setup();
  api.update.mockResolvedValueOnce({ data: { ...items[0], name: "更新済み" } });
  await user.click(screen.getByRole("button", { name: "編集を保存" }));
  expect(await screen.findByRole("button", { name: "更新済み" })).toBeVisible();
  expect(api.load).not.toHaveBeenCalled();
  expect(api.categories).not.toHaveBeenCalled();
});

it.each(["編集を保存", "新規保存"])(
  "saving an existing category does not refetch the registry: %s",
  async (button) => {
    const { items, user, status } = setup();
    const saved = { ...items[0], name: "保存済み", categoryId: cid("登録済み") };
    api.update.mockResolvedValueOnce({ data: saved });
    api.create.mockResolvedValueOnce({ data: saved });
    await user.click(screen.getByRole("button", { name: button }));
    expect(await screen.findByRole("button", { name: "保存済み" })).toBeVisible();
    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(api.categories).not.toHaveBeenCalled();
  },
);

it("refreshes category choices after a stale category conflict without changing the ToDo", async () => {
  const { user, client, items, status } = setup();
  api.update.mockRejectedValueOnce({
    name: "ApiRequestError",
    status: 409,
    message: "カテゴリーが変更されました",
  });
  await user.click(screen.getByRole("button", { name: "編集を保存" }));
  await waitFor(() => expect(api.categories).toHaveBeenCalledTimes(1));
  expect(client.getQueryData(queryKeys.todoItems)).toEqual(items);
  expect(status).toHaveBeenCalledWith(expect.stringContaining("失敗"));
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
