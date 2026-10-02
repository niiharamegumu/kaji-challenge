import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { resolvedData } from "../../../test/apiMock";
import { renderWithProviders, resetTestQueryClient } from "../../../test/render";
import { MemoryRouter } from "../../../test/router";
import { categoryIdFixture, categoryOrderFixture } from "../../../test/todoCategories";
import { HomeTodoListPanel } from "./HomeTodoListPanel";
import { DelayedActionProvider } from "../../../shared/state/DelayedActionProvider";

const mockListTodoCategories = vi.fn();
vi.mock("../../../lib/api/operations", async () => ({
  ...(await vi.importActual<object>("../../../lib/api/operations")),
  listTodoCategories: (...args: unknown[]) => mockListTodoCategories(...args),
}));

beforeEach(() => {
  resetTestQueryClient();
  mockListTodoCategories.mockReset();
  mockListTodoCategories.mockResolvedValue(
    resolvedData({ categories: categoryOrderFixture("仕事", null, "空") }),
  );
});
afterEach(cleanup);

it("filters the home ToDos by swipe and still supports category button clicks", async () => {
  const user = userEvent.setup();
  const onReorder = vi.fn();
  const onDelete = vi.fn();
  renderWithProviders(
    <DelayedActionProvider>
      <MemoryRouter>
        <HomeTodoListPanel
          items={[
            {
              id: "work",
              categoryId: categoryIdFixture("仕事"),
              name: "仕事のToDo",
              teamId: "team-1",
              notes: null,
              sortKey: 1,
              createdAt: "2026-09-30T00:00:00Z",
              updatedAt: "2026-09-30T00:00:00Z",
            },
            {
              id: "unclassified",
              categoryId: null,
              name: "未分類のToDo",
              teamId: "team-1",
              notes: null,
              sortKey: 2,
              createdAt: "2026-09-30T00:00:00Z",
              updatedAt: "2026-09-30T00:00:00Z",
            },
          ]}
          isReordering={false}
          isUpdating={false}
          onDelete={onDelete}
          onReorder={onReorder}
          onUpdate={vi.fn()}
        />
      </MemoryRouter>
    </DelayedActionProvider>,
  );
  const filter = await screen.findByRole("group", { name: "カテゴリーで絞り込み" });
  await within(filter).findByRole("button", { name: "仕事" });
  const swipe = async (target: HTMLElement, clientX: number) => {
    await user.pointer([
      { keys: "[TouchA>]", target, coords: { clientX: 160, clientY: 100 } },
      { pointerName: "TouchA", coords: { clientX, clientY: 105 } },
      { keys: "[/TouchA]" },
    ]);
  };
  await swipe(screen.getByText("仕事のToDo"), 60);
  expect(within(filter).getByRole("button", { name: "仕事" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.queryByText("未分類のToDo")).not.toBeInTheDocument();
  await swipe(screen.getByText("仕事のToDo"), 60);
  expect(screen.getByText("未分類のToDo")).toBeVisible();
  expect(screen.queryByText("仕事のToDo")).not.toBeInTheDocument();
  await swipe(screen.getByText("未分類のToDo"), 60);
  expect(screen.getByText("このカテゴリーのToDoはありません。")).toBeVisible();
  await swipe(screen.getByText("このカテゴリーのToDoはありません。"), 260);
  expect(screen.getByText("未分類のToDo")).toBeVisible();
  await user.click(within(filter).getByRole("button", { name: "すべて" }));
  expect(screen.getByText("仕事のToDo")).toBeVisible();
  expect(screen.getByText("未分類のToDo")).toBeVisible();
  expect(onReorder).not.toHaveBeenCalled();
  expect(onDelete).not.toHaveBeenCalled();
});
