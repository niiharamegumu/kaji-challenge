import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RootLayoutContext } from "../../../shared/router/rootLayoutContext";
import { appQueryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/queryKeys";
import {
  defaultUserPreferences,
  type TodoCategorySelection,
} from "../../../contracts/user-preferences";
import { resolvedData } from "../../../test/apiMock";
import { renderWithProviders, resetTestQueryClient } from "../../../test/render";
import { PreferencesFixture } from "../../../test/userPreferences";
import { categoryIdFixture, categoryOrderFixture } from "../../../test/todoCategories";
import { useTodoCategoryFilter } from "../hooks/useTodoCategoryFilter";
import { TodoCategoryFilter } from "./TodoCategoryFilter";
import { TodoDefaultCategorySettings } from "./TodoDefaultCategorySettings";

const listCategories = vi.fn();
vi.mock("../../../lib/api/operations", async () => ({
  ...(await vi.importActual<object>("../../../lib/api/operations")),
  listTodoCategories: (...args: unknown[]) => listCategories(...args),
}));
const shopping = { kind: "category" as const, id: categoryIdFixture("買い物") };
const select = () => screen.getByRole("combobox", { name: "最初に表示するToDoカテゴリー" });
const update = vi.fn();
function Filter() {
  const { categoriesQuery, selection, setSelection } = useTodoCategoryFilter();
  return (
    <TodoCategoryFilter
      categoriesQuery={categoriesQuery}
      value={selection}
      onChange={setSelection}
    />
  );
}
function Scene({
  selection = shopping,
  team = "team",
  ready = true,
}: {
  selection?: TodoCategorySelection;
  team?: string;
  ready?: boolean;
}) {
  return (
    <RootLayoutContext
      value={{
        currentUserId: "user",
        currentTeamId: team,
        currentTeamName: team,
        displayName: "User",
        colorHex: null,
      }}
    >
      <PreferencesFixture
        preferences={{ ...defaultUserPreferences, defaultTodoCategory: selection }}
        ready={ready}
        writable={ready}
        update={update}
      >
        <TodoDefaultCategorySettings />
        <Filter />
      </PreferencesFixture>
    </RootLayoutContext>
  );
}
const tab = (name: string) => screen.getByRole("button", { name });
beforeEach(() => {
  resetTestQueryClient();
  update.mockReset();
  listCategories
    .mockReset()
    .mockResolvedValue(resolvedData({ categories: categoryOrderFixture("仕事", null, "買い物") }));
});
afterEach(cleanup);

it("uses account preferences, preserves category order and sends only the selected category", async () => {
  renderWithProviders(<Scene />);
  await waitFor(() => expect(select()).toBeEnabled());
  expect(
    within(select())
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["すべて", "仕事", "未分類", "買い物"]);
  expect(tab("買い物")).toHaveAttribute("aria-pressed", "true");
  fireEvent.change(select(), { target: { value: "unclassified" } });
  expect(update).toHaveBeenCalledWith({ defaultTodoCategory: { kind: "unclassified" } });
});

it("adopts the server default after cache restoration but preserves a manually selected tab", async () => {
  const view = renderWithProviders(<Scene selection={{ kind: "all" }} />);
  await waitFor(() => expect(select()).toBeEnabled());
  view.rerender(<Scene />);
  expect(tab("買い物")).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(tab("仕事"));
  view.rerender(<Scene selection={{ kind: "unclassified" }} />);
  expect(select()).toHaveValue("unclassified");
  expect(tab("仕事")).toHaveAttribute("aria-pressed", "true");
});

it("retains the same user preference across teams and falls back without saving when unavailable", async () => {
  const view = renderWithProviders(<Scene />);
  await waitFor(() => expect(select()).toBeEnabled());
  fireEvent.click(tab("未分類"));
  view.rerender(<Scene team="another-team" />);
  expect(tab("買い物")).toHaveAttribute("aria-pressed", "true");
  act(() => appQueryClient.setQueryData(queryKeys.todoCategories, [null]));
  await waitFor(() => expect(tab("すべて")).toHaveAttribute("aria-pressed", "true"));
  expect(select()).toHaveValue("all");
  expect(update).not.toHaveBeenCalled();
});

it("retains IDs through renaming/reordering", async () => {
  renderWithProviders(<Scene />);
  await waitFor(() => expect(select()).toBeEnabled());
  act(() =>
    appQueryClient.setQueryData(queryKeys.todoCategories, [
      { id: shopping.id, name: "スーパー" },
      null,
    ]),
  );
  await waitFor(() => expect(tab("スーパー")).toHaveAttribute("aria-pressed", "true"));
  await waitFor(() => expect(select()).toHaveValue("category:" + shopping.id));
});

it("adopts a valid server preference after an unavailable cached default", async () => {
  const view = renderWithProviders(
    <Scene selection={{ kind: "category", id: crypto.randomUUID() }} />,
  );
  await waitFor(() => expect(select()).toBeEnabled());
  expect(tab("すべて")).toHaveAttribute("aria-pressed", "true");
  view.rerender(<Scene />);
  expect(tab("買い物")).toHaveAttribute("aria-pressed", "true");
});

it("does not discard preferences while categories load or override a manual choice made during loading", async () => {
  let resolve!: (value: unknown) => void;
  listCategories.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  renderWithProviders(<Scene />);
  expect(select()).toBeDisabled();
  fireEvent.click(tab("すべて"));
  await act(async () =>
    resolve(resolvedData({ categories: categoryOrderFixture(null, "買い物") })),
  );
  expect(tab("すべて")).toHaveAttribute("aria-pressed", "true");
  await waitFor(() => expect(select()).toHaveValue("category:" + shopping.id));
});
