import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetApiMocks, resolvedData } from "../../../test/apiMock";
import { withExpectedConsoleError } from "../../../test/console";
import { renderWithProviders, resetTestQueryClient } from "../../../test/render";
import { ShoppingListPage } from "./ShoppingListPage";

const mockListShoppingItems = vi.fn();
const mockPostShoppingItem = vi.fn();
const mockPatchShoppingItem = vi.fn();
const mockDeleteShoppingItem = vi.fn();
const mockPostShoppingItemsReorder = vi.fn();
const apiMocks = {
  mockListShoppingItems,
  mockPostShoppingItem,
  mockPatchShoppingItem,
  mockDeleteShoppingItem,
  mockPostShoppingItemsReorder,
};

vi.mock("../../../lib/api/operations", async () => {
  const actual = await vi.importActual<object>("../../../lib/api/operations");
  return {
    ...actual,
    listShoppingItems: (...args: unknown[]) => mockListShoppingItems(...args),
    postShoppingItem: (...args: unknown[]) => mockPostShoppingItem(...args),
    patchShoppingItem: (...args: unknown[]) => mockPatchShoppingItem(...args),
    deleteShoppingItem: (...args: unknown[]) => mockDeleteShoppingItem(...args),
    postShoppingItemsReorder: (...args: unknown[]) => mockPostShoppingItemsReorder(...args),
  };
});

describe("ShoppingListPage", () => {
  beforeEach(() => {
    resetTestQueryClient();
    resetApiMocks(apiMocks);
    mockListShoppingItems.mockResolvedValue(resolvedData({ items: [] }));
    mockPostShoppingItem.mockImplementation((payload) =>
      Promise.resolve(
        resolvedData({
          id: "item-created",
          teamId: "team-1",
          name: "item",
          sortKey: 1,
          createdAt: "2026-02-01T00:00:00Z",
          updatedAt: "2026-02-01T00:00:00Z",
          ...payload,
        }),
      ),
    );
    mockPatchShoppingItem.mockImplementation((id, payload) =>
      Promise.resolve(
        resolvedData({
          teamId: "team-1",
          name: "item",
          sortKey: 1,
          createdAt: "2026-02-01T00:00:00Z",
          updatedAt: "2026-02-01T00:00:00Z",
          id,
          ...payload,
        }),
      ),
    );
    mockDeleteShoppingItem.mockResolvedValue(resolvedData({}));
    mockPostShoppingItemsReorder.mockResolvedValue(resolvedData({ items: [] }));
  });

  afterEach(() => {
    cleanup();
  });

  const renderPage = () =>
    renderWithProviders(<ShoppingListPage />, {
      errorMessage: "買い物リスト画面の読み込みに失敗しました。",
    });

  it("creates a shopping item from the form", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "追加" }));
    expect(await screen.findByRole("dialog", { name: "買い物項目を追加" })).toBeInTheDocument();
    expect(screen.queryByLabelText("数量")).not.toBeInTheDocument();

    await user.type(await screen.findByLabelText("名前"), "牛乳");
    await user.type(screen.getByLabelText("メモ"), "低脂肪");
    await user.click(screen.getByRole("button", { name: "追加する" }));

    await waitFor(() => {
      expect(mockPostShoppingItem).toHaveBeenCalledWith({
        name: "牛乳",
        notes: "低脂肪",
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "買い物項目を追加" })).not.toBeInTheDocument();
    });
  });

  it("shows a created shopping item at the top immediately", async () => {
    mockListShoppingItems.mockResolvedValue({
      data: {
        items: [
          {
            id: "item-1",
            teamId: "team-1",
            name: "牛乳",
            notes: null,
            sortKey: 100,
            createdAt: "2026-03-01T00:00:00Z",
            updatedAt: "2026-03-01T00:00:00Z",
          },
        ],
      },
    });
    mockPostShoppingItem.mockResolvedValue({
      data: {
        id: "item-2",
        teamId: "team-1",
        name: "卵",
        notes: null,
        sortKey: 200,
        createdAt: "2026-03-02T00:00:00Z",
        updatedAt: "2026-03-02T00:00:00Z",
      },
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "追加" }));
    const dialog = await screen.findByRole("dialog", {
      name: "買い物項目を追加",
    });
    await user.type(within(dialog).getByLabelText("名前"), "卵");
    await user.click(within(dialog).getByRole("button", { name: "追加する" }));

    await waitFor(() => {
      const listItems = screen.getAllByRole("listitem");
      expect(within(listItems[0]).getByText("卵")).toBeInTheDocument();
      expect(within(listItems[1]).getByText("牛乳")).toBeInTheDocument();
    });
  });

  it("clears the previous create error when reopening the form", async () => {
    mockPostShoppingItem.mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "追加" }));
    await user.type(screen.getByLabelText("名前"), "牛乳");
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存できませんでした");
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    await user.click(screen.getByRole("button", { name: "追加" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("名前")).toHaveValue("牛乳");
  });

  it("updates an item inline", async () => {
    mockListShoppingItems.mockResolvedValue({
      data: {
        items: [
          {
            id: "item-1",
            teamId: "team-1",
            name: "牛乳",
            notes: "低脂肪",
            sortKey: 1,
            createdAt: "2026-03-01T00:00:00Z",
            updatedAt: "2026-03-01T00:00:00Z",
          },
        ],
      },
    });
    const user = userEvent.setup();
    renderPage();

    const editButton = await screen.findByRole("button", { name: "編集" });
    const card = editButton.closest("li");
    if (card == null) {
      throw new Error("shopping item card not found");
    }
    await user.click(editButton);

    const nameInput = await within(card).findByLabelText("名前");
    const notesInput = within(card).getByLabelText("メモ");
    await user.clear(nameInput);
    await user.type(nameInput, "低脂肪乳");
    await user.clear(notesInput);
    await user.type(notesInput, "特売");
    await user.click(within(card).getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(mockPatchShoppingItem).toHaveBeenCalledWith("item-1", {
        name: "低脂肪乳",
        notes: "特売",
      });
    });
  });

  it("confirms before deleting a completed item", async () => {
    mockListShoppingItems.mockResolvedValue({
      data: {
        items: [
          {
            id: "item-1",
            teamId: "team-1",
            name: "牛乳",
            notes: null,
            sortKey: 1,
            createdAt: "2026-03-01T00:00:00Z",
            updatedAt: "2026-03-01T00:00:00Z",
          },
        ],
      },
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "購入済みにする" }));
    expect(await screen.findByText("購入済みにしますか？")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "購入済みにする" })[1]);

    await waitFor(() => {
      expect(mockDeleteShoppingItem).toHaveBeenCalledWith("item-1");
    });
  });

  it("prevents duplicate inline saves and keeps the draft when saving fails", async () => {
    mockListShoppingItems.mockResolvedValue(
      resolvedData({
        items: [
          {
            id: "item-1",
            teamId: "team-1",
            name: "牛乳",
            notes: null,
            sortKey: 1,
            createdAt: "2026-03-01T00:00:00Z",
            updatedAt: "2026-03-01T00:00:00Z",
          },
        ],
      }),
    );
    let reject!: (error: Error) => void;
    mockPatchShoppingItem.mockImplementationOnce(
      () =>
        new Promise((_, no) => {
          reject = no;
        }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "編集" }));
    await user.type(screen.getByLabelText("名前"), "追加");
    await user.click(screen.getByRole("button", { name: "保存" }));
    const saving = screen.getByRole("button", { name: "保存中…" });
    expect(saving).toBeDisabled();
    await user.click(saving);
    expect(mockPatchShoppingItem).toHaveBeenCalledTimes(1);
    await act(async () => {
      reject(new Error("offline"));
    });
    expect(screen.getByLabelText("名前")).toHaveValue("牛乳追加");
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });

  it("shows boundary error when the list query fails", async () => {
    await withExpectedConsoleError(async () => {
      mockListShoppingItems.mockRejectedValue(new Error("request failed: 500"));
      renderPage();

      await waitFor(
        () => {
          expect(
            screen.getByText("買い物リスト画面の読み込みに失敗しました。"),
          ).toBeInTheDocument();
        },
        { timeout: 4_000 },
      );
      expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
    });
  });
});
