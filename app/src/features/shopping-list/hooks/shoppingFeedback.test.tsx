import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ShoppingListItem } from "../../../lib/api/operations";
import { queryKeys } from "../../../shared/query/queryKeys";
import { MutationFeedback } from "../../../shared/components/MutationFeedback";
import { useShoppingItemMutations, useShoppingItemsQuery } from "./useShoppingList";

const api = vi.hoisted(() => ({ remove: vi.fn(), update: vi.fn(), load: vi.fn() }));
vi.mock("../../../lib/api/operations", async (original) => ({
  ...(await original<object>()),
  deleteShoppingItem: api.remove,
  patchShoppingItem: api.update,
  listShoppingItems: api.load,
}));
function Probe({ status }: { status: (message: string) => void }) {
  const { data } = useShoppingItemsQuery();
  const { removeItem, updateItem } = useShoppingItemMutations(status);
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
      <MutationFeedback />
    </>
  );
}
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  const items: ShoppingListItem[] = ["A", "B"].map((id) => ({
    id,
    name: id,
    teamId: "team",
    sortKey: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  }));
  client.setQueryData(queryKeys.shoppingItems, items);
  api.load.mockReset().mockReturnValue(new Promise(() => {}));
  const status = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <Probe status={status} />
    </QueryClientProvider>,
  );
  return { client, status, items, user: userEvent.setup() };
}

it("hides purchased items before the response and restores only the failed item", async () => {
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
  expect(client.getQueryData<ShoppingListItem[]>(queryKeys.shoppingItems)).toHaveLength(2);
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
});

afterEach(cleanup);
