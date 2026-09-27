import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetApiMocks, resolvedData } from "../../../test/apiMock";
import { withExpectedConsoleError } from "../../../test/console";
import { renderWithProviders, resetTestQueryClient } from "../../../test/render";
import { TodoPage } from "./TodoPage";
import { TodoCategoriesPage } from "./TodoCategoriesPage";

const mockListTodoItems = vi.fn();
const mockListTodoCategories = vi.fn();
const mockPostTodoCategory = vi.fn();
const mockDeleteTodoCategory = vi.fn();
const mockPostTodoItem = vi.fn();
const mockPatchTodoItem = vi.fn();
const mockDeleteTodoItem = vi.fn();
const mockPostTodoItemsReorder = vi.fn();
const apiMocks = {
  mockListTodoCategories,
  mockPostTodoCategory,
  mockDeleteTodoCategory,
  mockListTodoItems,
  mockPostTodoItem,
  mockPatchTodoItem,
  mockDeleteTodoItem,
  mockPostTodoItemsReorder,
};

vi.mock("../../../lib/api/operations", async () => {
  const actual = await vi.importActual<object>("../../../lib/api/operations");
  return {
    ...actual,
    listTodoCategories: (...args: unknown[]) => mockListTodoCategories(...args),
    postTodoCategory: (...args: unknown[]) => mockPostTodoCategory(...args),
    deleteTodoCategory: (...args: unknown[]) => mockDeleteTodoCategory(...args),
    listTodoItems: (...args: unknown[]) => mockListTodoItems(...args),
    postTodoItem: (...args: unknown[]) => mockPostTodoItem(...args),
    patchTodoItem: (...args: unknown[]) => mockPatchTodoItem(...args),
    deleteTodoItem: (...args: unknown[]) => mockDeleteTodoItem(...args),
    postTodoItemsReorder: (...args: unknown[]) => mockPostTodoItemsReorder(...args),
  };
});

describe("ToDo pages", () => {
  beforeEach(() => {
    resetTestQueryClient();
    resetApiMocks(apiMocks);
    mockListTodoCategories.mockResolvedValue(resolvedData({ categories: [] }));
    mockPostTodoCategory.mockResolvedValue(resolvedData({ categories: [] }));
    mockDeleteTodoCategory.mockResolvedValue(resolvedData({}));
    mockListTodoItems.mockResolvedValue(resolvedData({ items: [] }));
    mockPostTodoItem.mockImplementation((payload) =>
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
    mockPatchTodoItem.mockImplementation((id, payload) =>
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
    mockDeleteTodoItem.mockResolvedValue(resolvedData({}));
    mockPostTodoItemsReorder.mockResolvedValue(resolvedData({ items: [] }));
  });

  afterEach(() => {
    cleanup();
  });

  const renderPage = () =>
    renderWithProviders(<TodoPage />, {
      errorMessage: "ToDo画面の読み込みに失敗しました。",
    });

  it("creates a todo item from the form", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "追加" }));
    expect(await screen.findByRole("dialog", { name: "ToDoを追加" })).toBeInTheDocument();
    expect(screen.queryByLabelText("数量")).not.toBeInTheDocument();

    await user.type(await screen.findByLabelText("名前"), "牛乳");
    await user.type(screen.getByLabelText("メモ"), "低脂肪");
    await user.click(screen.getByRole("button", { name: "追加する" }));

    await waitFor(() => {
      expect(mockPostTodoItem).toHaveBeenCalledWith({
        name: "牛乳",
        category: null,
        notes: "低脂肪",
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "ToDoを追加" })).not.toBeInTheDocument();
    });
  });

  it("shows a created todo item at the top immediately", async () => {
    mockListTodoItems.mockResolvedValue({
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
    mockPostTodoItem.mockResolvedValue({
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
      name: "ToDoを追加",
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
    mockPostTodoItem.mockRejectedValueOnce(new Error("offline"));
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
    mockListTodoItems.mockResolvedValue({
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
      throw new Error("todo item card not found");
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
      expect(mockPatchTodoItem).toHaveBeenCalledWith("item-1", {
        name: "低脂肪乳",
        notes: "特売",
        category: null,
      });
    });
  });

  it("confirms before deleting a completed item", async () => {
    mockListTodoItems.mockResolvedValue({
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

    await user.click(await screen.findByRole("button", { name: "完了にする" }));
    expect(await screen.findByText("完了にしますか？")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "完了にする" })[1]);

    await waitFor(() => {
      expect(mockDeleteTodoItem).toHaveBeenCalledWith("item-1");
    });
  });

  it("prevents duplicate inline saves and keeps the draft when saving fails", async () => {
    mockListTodoItems.mockResolvedValue(
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
    mockPatchTodoItem.mockImplementationOnce(
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
    expect(mockPatchTodoItem).toHaveBeenCalledTimes(1);
    await act(async () => {
      reject(new Error("offline"));
    });
    expect(screen.getByLabelText("名前")).toHaveValue("牛乳追加");
    expect(await screen.findByRole("button", { name: "保存" })).toBeEnabled();
  });

  it("shows boundary error when the list query fails", async () => {
    await withExpectedConsoleError(async () => {
      mockListTodoItems.mockRejectedValue(new Error("request failed: 500"));
      renderPage();

      await waitFor(
        () => {
          expect(screen.getByText("ToDo画面の読み込みに失敗しました。")).toBeInTheDocument();
        },
        { timeout: 4_000 },
      );
      expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
    });
  });
  const fixture = (id: string, name: string, category: string | null) => ({
    id,
    name,
    category,
    teamId: "team-1",
    notes: null,
    sortKey: 100,
    createdAt: "2026-09-27T00:00:00Z",
    updatedAt: "2026-09-27T00:00:00Z",
  });

  it("filters registered categories, unclassified items and empty categories", async () => {
    const user = userEvent.setup();
    mockListTodoCategories.mockResolvedValue(
      resolvedData({ categories: ["買い物リスト", "やることリスト", "空のカテゴリー"] }),
    );
    mockListTodoItems.mockResolvedValue(
      resolvedData({
        items: [
          fixture("a", "牛乳", "買い物リスト"),
          fixture("b", "電話する", "やることリスト"),
          fixture("c", "あとで分類", null),
        ],
      }),
    );
    renderPage();
    const filter = await screen.findByRole("group", { name: "カテゴリーで絞り込み" });
    expect(screen.queryByLabelText("新しいカテゴリー")).not.toBeInTheDocument();
    expect(within(filter).getByRole("button", { name: "すべて" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() =>
      expect(within(filter).getByRole("button", { name: "買い物リスト" })).toBeInTheDocument(),
    );
    await user.click(within(filter).getByRole("button", { name: "買い物リスト" }));
    expect(within(filter).getByRole("button", { name: "買い物リスト" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("牛乳")).toBeVisible();
    expect(screen.queryByText("電話する")).not.toBeInTheDocument();
    expect(screen.queryByText("あとで分類")).not.toBeInTheDocument();
    await user.click(within(filter).getByRole("button", { name: "未分類" }));
    expect(screen.getByText("あとで分類")).toBeVisible();
    expect(screen.queryByText("牛乳")).not.toBeInTheDocument();
    await user.click(within(filter).getByRole("button", { name: "空のカテゴリー" }));
    expect(screen.queryByRole("button", { name: "編集" })).not.toBeInTheDocument();
    await user.click(within(filter).getByRole("button", { name: "すべて" }));
    expect(screen.getAllByRole("button", { name: "編集" })).toHaveLength(3);
  });

  it.each(["all", "unclassified", "category:外出"])(
    "treats %s as a literal category name",
    async (category) => {
      mockListTodoCategories.mockResolvedValue(resolvedData({ categories: [category] }));
      mockListTodoItems.mockResolvedValue(
        resolvedData({
          items: [fixture("a", "分類したToDo", category), fixture("b", "未分類のToDo", null)],
        }),
      );
      const user = userEvent.setup();
      renderPage();
      const filter = await screen.findByRole("group", { name: "カテゴリーで絞り込み" });
      await user.click(await within(filter).findByRole("button", { name: category }));
      expect(screen.getByText("分類したToDo")).toBeVisible();
      expect(screen.queryByText("未分類のToDo")).not.toBeInTheDocument();
      expect(within(filter).getByRole("button", { name: category })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    },
  );

  it("offers saved categories and creates a ToDo with a freely entered category", async () => {
    const user = userEvent.setup();
    mockListTodoCategories.mockResolvedValue(resolvedData({ categories: ["買い物リスト"] }));
    renderPage();
    await user.click(await screen.findByRole("button", { name: "追加" }));
    await user.type(screen.getByLabelText("名前"), "予約する");
    const input = screen.getByLabelText("カテゴリー（任意）");
    const suggestions = document.getElementById(input.getAttribute("list")!);
    expect(suggestions?.querySelector('option[value="買い物リスト"]')).not.toBeNull();
    await user.type(input, "外出");
    await user.click(screen.getByRole("button", { name: "追加する" }));
    await waitFor(() =>
      expect(mockPostTodoItem).toHaveBeenCalledWith({
        name: "予約する",
        notes: undefined,
        category: "外出",
      }),
    );
  });

  it("registers an empty category and removes a used category while keeping the ToDo", async () => {
    const user = userEvent.setup();
    mockListTodoCategories.mockResolvedValue(resolvedData({ categories: ["買い物リスト"] }));
    mockListTodoItems.mockResolvedValue(
      resolvedData({ items: [fixture("a", "牛乳", "買い物リスト")] }),
    );
    mockPostTodoCategory.mockImplementation(async () => {
      mockListTodoCategories.mockResolvedValue(
        resolvedData({ categories: ["買い物リスト", "空"] }),
      );
      return resolvedData({ categories: ["買い物リスト", "空"] });
    });
    mockDeleteTodoCategory.mockImplementation(async () => {
      mockListTodoCategories.mockResolvedValue(resolvedData({ categories: ["空"] }));
      mockListTodoItems.mockResolvedValue(resolvedData({ items: [fixture("a", "牛乳", null)] }));
      return resolvedData({});
    });
    const view = renderWithProviders(<TodoCategoriesPage />);
    await user.type(screen.getByLabelText("新しいカテゴリー"), "空");
    await user.click(screen.getByRole("button", { name: "カテゴリーを追加" }));
    expect(await screen.findByRole("button", { name: "空 を削除" })).toBeVisible();
    expect(mockListTodoCategories).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "買い物リスト を削除" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "買い物リスト を削除" })).not.toBeInTheDocument(),
    );
    expect(mockDeleteTodoCategory).toHaveBeenCalledWith("買い物リスト");
    expect(mockDeleteTodoItem).not.toHaveBeenCalled();
    view.rerender(<TodoPage />);
    const filter = await screen.findByRole("group", { name: "カテゴリーで絞り込み" });
    await user.click(within(filter).getByRole("button", { name: "未分類" }));
    expect(await screen.findByText("牛乳")).toBeVisible();
  });

  it("keeps category input on a failed registration", async () => {
    const user = userEvent.setup();
    mockPostTodoCategory.mockRejectedValueOnce(new Error("offline"));
    renderWithProviders(<TodoCategoriesPage />);
    await user.type(screen.getByLabelText("新しいカテゴリー"), "大切な予定");
    await user.click(screen.getByRole("button", { name: "カテゴリーを追加" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存に失敗");
    expect(screen.getByLabelText("新しいカテゴリー")).toHaveValue("大切な予定");
  });
});
