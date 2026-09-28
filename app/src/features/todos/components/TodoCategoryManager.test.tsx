import {
  categoryOrderFixture as order,
  categoryIdFixture as cid,
} from "../../../test/todoCategories";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TodoCategoriesResponse } from "../../../lib/api/operations";
import { renderWithProviders, resetTestQueryClient } from "../../../test/render";
import { TodoCategoryManager } from "./TodoCategoryManager";

const api = vi.hoisted(() => ({ list: vi.fn(), reorder: vi.fn(), rename: vi.fn() }));
vi.mock("../../../lib/api/operations", async (original) => ({
  ...(await original<object>()),
  listTodoCategories: api.list,
  postTodoCategoriesReorder: api.reorder,
  patchTodoCategory: api.rename,
}));
type Drop = { active: { id: string }; over: { id: string } | null };
let drop: (event: Drop) => void;
// jsdom has no layout; browser tests exercise the actual drag sensors.
vi.mock("@dnd-kit/core", async (original) => ({
  ...(await original<object>()),
  DndContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd: typeof drop }) => {
    drop = onDragEnd;
    return <>{children}</>;
  },
}));
const labels = () =>
  within(screen.getByRole("list", { name: "カテゴリーの表示順" }))
    .getAllByRole("button", { name: /をドラッグして並び替え/ })
    .map((button) => button.getAttribute("aria-label"));
const drag = (from: string, to: string | null) =>
  act(() => drop({ active: { id: from }, over: to === null ? null : { id: to } }));
beforeEach(() => {
  resetTestQueryClient();
  api.list.mockReset().mockResolvedValue({ data: { categories: order(null, "買い物", "仕事") } });
  api.reorder.mockReset();
  api.rename.mockReset();
});
afterEach(cleanup);

it("shows the virtual unclassified row without a delete action, including zero registered categories", async () => {
  api.list.mockResolvedValue({ data: { categories: order(null) } });
  renderWithProviders(<TodoCategoryManager setStatus={vi.fn()} />);
  expect(
    await screen.findByRole("button", { name: "未分類 をドラッグして並び替え" }),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "未分類 を削除" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "未分類 を編集" })).not.toBeInTheDocument();
  expect(screen.getByText("カテゴリーはまだありません。")).toBeVisible();
});

it("renames by ID, blocks operations while saving and displays the returned order", async () => {
  let resolve!: (value: { data: TodoCategoriesResponse }) => void;
  api.rename.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const user = userEvent.setup();
  renderWithProviders(<TodoCategoryManager setStatus={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "買い物 を編集" }));
  const dialog = screen.getByRole("dialog", { name: "カテゴリー名を変更" });
  const input = within(dialog).getByLabelText("カテゴリー名");
  expect(input).toHaveValue("買い物");
  await user.clear(input);
  expect(within(dialog).getByRole("button", { name: "保存" })).toBeDisabled();
  await user.type(input, " 買い出し ");
  await user.click(within(dialog).getByRole("button", { name: "保存" }));
  expect(api.rename).toHaveBeenCalledWith(cid("買い物"), { name: "買い出し" });
  expect(input).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "閉じる" })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "保存中…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "仕事 を編集" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "買い物 を削除" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "買い物 をドラッグして並び替え" })).toBeDisabled();
  await drag("unclassified", `category:${cid("仕事")}`);
  expect(api.reorder).not.toHaveBeenCalled();
  await act(async () =>
    resolve({
      data: { categories: [null, { id: cid("買い物"), name: "買い出し" }, ...order("仕事")] },
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(labels()).toEqual([
    "未分類 をドラッグして並び替え",
    "買い出し をドラッグして並び替え",
    "仕事 をドラッグして並び替え",
  ]);
});

it("keeps a failed rename draft for retry and resets the error when opening another category", async () => {
  api.rename.mockRejectedValueOnce(new Error("offline"));
  const user = userEvent.setup();
  renderWithProviders(<TodoCategoryManager setStatus={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "買い物 を編集" }));
  await user.clear(screen.getByLabelText("カテゴリー名"));
  await user.type(screen.getByLabelText("カテゴリー名"), "買い出し");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("保存に失敗");
  expect(screen.getByLabelText("カテゴリー名")).toHaveValue("買い出し");
  expect(screen.getByRole("button", { name: "買い物 を編集" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "閉じる" }));
  await user.click(screen.getByRole("button", { name: "仕事 を編集" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByLabelText("カテゴリー名")).toHaveValue("仕事");
  await user.click(screen.getByRole("button", { name: "閉じる" }));
  expect(api.rename).toHaveBeenCalledTimes(1);
});

it("shows the pending order, blocks mutations during save, then keeps the server order", async () => {
  let resolve!: (value: { data: TodoCategoriesResponse }) => void;
  api.reorder.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const setStatus = vi.fn();
  renderWithProviders(<TodoCategoryManager setStatus={setStatus} />);
  await screen.findByRole("button", { name: "未分類 をドラッグして並び替え" });
  await drag("unclassified", `category:${cid("仕事")}`);
  expect(api.reorder).toHaveBeenCalledWith({
    categoryIds: order("買い物", "仕事", null).map((category) => category?.id ?? null),
  });
  await waitFor(() =>
    expect(labels()).toEqual([
      "買い物 をドラッグして並び替え",
      "仕事 をドラッグして並び替え",
      "未分類 をドラッグして並び替え",
    ]),
  );
  expect(screen.getByRole("button", { name: "買い物 を削除" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "仕事 をドラッグして並び替え" })).toBeDisabled();
  expect(screen.getByLabelText("新しいカテゴリー")).toBeDisabled();
  await drag(`category:${cid("買い物")}`, "unclassified");
  expect(api.reorder).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ data: { categories: order("買い物", "仕事", null) } }));
  expect(setStatus).toHaveBeenCalledWith("カテゴリーの並び順を保存しました");
  expect(labels().at(-1)).toBe("未分類 をドラッグして並び替え");
  await waitFor(() => expect(screen.getByRole("button", { name: "買い物 を削除" })).toBeEnabled());
});

it("restores the fetched order after a failed save and allows retry without clearing the add draft", async () => {
  const user = userEvent.setup();
  api.reorder.mockRejectedValueOnce(new Error("conflict"));
  const setStatus = vi.fn();
  renderWithProviders(<TodoCategoryManager setStatus={setStatus} />);
  await screen.findByRole("button", { name: "未分類 をドラッグして並び替え" });
  await user.type(screen.getByLabelText("新しいカテゴリー"), "次に追加");
  api.list.mockResolvedValue({
    data: { categories: order(null, "買い物", "仕事", "別メンバーの追加") },
  });
  await drag("unclassified", `category:${cid("仕事")}`);
  expect(await screen.findByRole("alert")).toHaveTextContent("保存に失敗");
  await waitFor(() => expect(labels()).toHaveLength(4));
  expect(labels()[0]).toBe("未分類 をドラッグして並び替え");
  expect(screen.getByLabelText("新しいカテゴリー")).toHaveValue("次に追加");
  api.reorder.mockResolvedValue({
    data: { categories: order("買い物", null, "仕事", "別メンバーの追加") },
  });
  await drag("unclassified", `category:${cid("買い物")}`);
  await waitFor(() => expect(setStatus).toHaveBeenCalledWith("カテゴリーの並び順を保存しました"));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("ignores a cancelled or unchanged drag and separates reserved-looking names from null", async () => {
  api.list.mockResolvedValue({ data: { categories: order(null, "unclassified", "仕事") } });
  api.reorder.mockResolvedValue({ data: { categories: order("unclassified", null, "仕事") } });
  renderWithProviders(<TodoCategoryManager setStatus={vi.fn()} />);
  await screen.findByRole("button", { name: "未分類 をドラッグして並び替え" });
  await drag("unclassified", null);
  await drag("unclassified", "unclassified");
  expect(api.reorder).not.toHaveBeenCalled();
  await drag(`category:${cid("unclassified")}`, "unclassified");
  expect(api.reorder).toHaveBeenCalledWith({
    categoryIds: order("unclassified", null, "仕事").map((category) => category?.id ?? null),
  });
});
