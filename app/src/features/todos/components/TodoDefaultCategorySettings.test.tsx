import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createStore } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RootLayoutContext } from "../../../shared/router/rootLayoutContext";
import { appQueryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/queryKeys";
import { resolvedData } from "../../../test/apiMock";
import { renderWithProviders, resetTestQueryClient } from "../../../test/render";
import { categoryIdFixture, categoryOrderFixture } from "../../../test/todoCategories";
import { useTodoCategoryFilter } from "../hooks/useTodoCategoryFilter";
import {
  createTodoDefaultCategoryAtom,
  todoDefaultCategoryStorageKey,
} from "../model/defaultTodoCategory";
import { TodoCategoryFilter } from "./TodoCategoryFilter";
import { TodoDefaultCategorySettings } from "./TodoDefaultCategorySettings";

const listCategories = vi.fn();
vi.mock("../../../lib/api/operations", async () => ({
  ...(await vi.importActual<object>("../../../lib/api/operations")),
  listTodoCategories: (...args: unknown[]) => listCategories(...args),
}));
const key = todoDefaultCategoryStorageKey("user:team");
const shopping = { kind: "category", id: categoryIdFixture("買い物") };
const select = () => screen.getByRole("combobox", { name: "最初に表示するToDoカテゴリー" });
function Filter({ team = "team" }: { team?: string }) {
  return (
    <RootLayoutContext.Provider
      value={{
        currentUserId: "user",
        currentTeamId: team,
        currentTeamName: team,
        displayName: "User",
        colorHex: null,
      }}
    >
      <FilterContent />
    </RootLayoutContext.Provider>
  );
}
function FilterContent() {
  const { categoriesQuery, selection, setSelection } = useTodoCategoryFilter();
  return (
    <TodoCategoryFilter
      categoriesQuery={categoriesQuery}
      value={selection}
      onChange={setSelection}
    />
  );
}
const tab = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  window.localStorage.clear();
  resetTestQueryClient();
  listCategories
    .mockReset()
    .mockResolvedValue(resolvedData({ categories: categoryOrderFixture("仕事", null, "買い物") }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

it("saves an initial category independently of tab order and restores it on each new page", async () => {
  const settings = renderWithProviders(<TodoDefaultCategorySettings identityKey="user:team" />);
  await waitFor(() => expect(select()).toBeEnabled());
  expect(
    within(select())
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["すべて", "仕事", "未分類", "買い物"]);
  fireEvent.change(select(), { target: { value: `category:${shopping.id}` } });
  expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual(shopping);
  settings.unmount();
  const firstPage = renderWithProviders(<Filter />);
  await waitFor(() => expect(tab("買い物")).toHaveAttribute("aria-pressed", "true"));
  expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
    "すべて",
    "仕事",
    "未分類",
    "買い物",
  ]);
  fireEvent.click(tab("すべて"));
  await appQueryClient.invalidateQueries({ queryKey: queryKeys.todoCategories });
  expect(tab("すべて")).toHaveAttribute("aria-pressed", "true");
  expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual(shopping);
  firstPage.unmount();
  renderWithProviders(<Filter />);
  await waitFor(() => expect(tab("買い物")).toHaveAttribute("aria-pressed", "true"));
});

it.each(["all", "unclassified"])(
  "persists and restores %s separately from named categories",
  async (kind) => {
    const view = renderWithProviders(<TodoDefaultCategorySettings identityKey="user:team" />);
    await waitFor(() => expect(select()).toBeEnabled());
    fireEvent.change(select(), { target: { value: kind } });
    view.unmount();
    renderWithProviders(<Filter />);
    await waitFor(() =>
      expect(tab(kind === "all" ? "すべて" : "未分類")).toHaveAttribute("aria-pressed", "true"),
    );
  },
);

it("retains the category ID through renaming and reordering, then falls back if deleted", async () => {
  window.localStorage.setItem(key, JSON.stringify(shopping));
  const view = renderWithProviders(<Filter />);
  await waitFor(() => expect(tab("買い物")).toHaveAttribute("aria-pressed", "true"));
  act(() =>
    appQueryClient.setQueryData(queryKeys.todoCategories, [
      { id: shopping.id, name: "スーパー" },
      null,
    ]),
  );
  await waitFor(() => expect(tab("スーパー")).toHaveAttribute("aria-pressed", "true"));
  listCategories.mockResolvedValue(resolvedData({ categories: [null] }));
  act(() => appQueryClient.setQueryData(queryKeys.todoCategories, [null]));
  await waitFor(() => expect(tab("すべて")).toHaveAttribute("aria-pressed", "true"));
  view.unmount();
  renderWithProviders(<TodoDefaultCategorySettings identityKey="user:team" />);
  await waitFor(() => expect(select()).toHaveValue("all"));
});

it("waits for category data without discarding the saved preference or overriding a manual choice", async () => {
  let resolve!: (
    value: ReturnType<typeof resolvedData<{ categories: ReturnType<typeof categoryOrderFixture> }>>,
  ) => void;
  listCategories.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  window.localStorage.setItem(key, JSON.stringify(shopping));
  renderWithProviders(<Filter />);
  fireEvent.click(tab("すべて"));
  await act(async () =>
    resolve(resolvedData({ categories: categoryOrderFixture(null, "買い物") })),
  );
  expect(tab("すべて")).toHaveAttribute("aria-pressed", "true");
  expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual(shopping);
});

it("isolates users and teams and applies the new team's default on a context change", async () => {
  window.localStorage.setItem(key, JSON.stringify(shopping));
  window.localStorage.setItem(
    todoDefaultCategoryStorageKey("user:other"),
    JSON.stringify({ kind: "unclassified" }),
  );
  const view = renderWithProviders(<Filter />);
  await waitFor(() => expect(tab("買い物")).toHaveAttribute("aria-pressed", "true"));
  view.rerender(<Filter team="other" />);
  await waitFor(() => expect(tab("未分類")).toHaveAttribute("aria-pressed", "true"));
  view.unmount();
  renderWithProviders(<TodoDefaultCategorySettings identityKey="another-user:team" />);
  await waitFor(() => expect(select()).toBeEnabled());
  expect(select()).toHaveValue("all");
});

it("keeps a saved category while the first category request is pending", async () => {
  let resolve!: (
    value: ReturnType<typeof resolvedData<{ categories: ReturnType<typeof categoryOrderFixture> }>>,
  ) => void;
  listCategories.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  window.localStorage.setItem(key, JSON.stringify(shopping));
  renderWithProviders(<Filter />);
  expect(screen.getByRole("status")).toHaveTextContent("カテゴリーを読み込み中");
  await act(async () =>
    resolve(resolvedData({ categories: categoryOrderFixture(null, "買い物") })),
  );
  await waitFor(() => expect(tab("買い物")).toHaveAttribute("aria-pressed", "true"));
});

it.each([
  "broken",
  "null",
  "[]",
  '"all"',
  '{"kind":"category"}',
  '{"kind":"category","id":1}',
  '{"kind":"unknown"}',
])("falls back safely for invalid storage %s", async (stored) => {
  window.localStorage.setItem(key, stored);
  renderWithProviders(<TodoDefaultCategorySettings identityKey="user:team" />);
  await waitFor(() => expect(select()).toBeEnabled());
  expect(select()).toHaveValue("all");
  expect(window.localStorage.getItem(key)).toBe(stored);
});

it("handles unavailable storage and reports a failed write without pretending it was saved", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw new Error("full");
  });
  renderWithProviders(<TodoDefaultCategorySettings identityKey="user:team" />);
  await waitFor(() => expect(select()).toBeEnabled());
  fireEvent.change(select(), { target: { value: `category:${shopping.id}` } });
  expect(select()).toHaveValue("all");
  expect(screen.getByRole("alert")).toHaveTextContent("保存できませんでした");
  fireEvent.change(select(), { target: { value: `category:${shopping.id}` } });
  expect(write).toHaveBeenCalledTimes(2);
  expect(select()).toHaveValue(`category:${shopping.id}`);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("syncs settings from another tab without changing an already open filter", async () => {
  renderWithProviders(
    <>
      <TodoDefaultCategorySettings identityKey="user:team" />
      <Filter />
    </>,
  );
  await waitFor(() => expect(select()).toBeEnabled());
  fireEvent.click(tab("仕事"));
  act(() => {
    window.localStorage.setItem(key, JSON.stringify(shopping));
    window.dispatchEvent(new StorageEvent("storage", { key, storageArea: window.localStorage }));
  });
  expect(select()).toHaveValue(`category:${shopping.id}`);
  expect(tab("仕事")).toHaveAttribute("aria-pressed", "true");
  act(() => {
    window.localStorage.clear();
    window.dispatchEvent(
      new StorageEvent("storage", { key: null, storageArea: window.localStorage }),
    );
  });
  expect(select()).toHaveValue("all");
  expect(tab("仕事")).toHaveAttribute("aria-pressed", "true");
});

it("does not read browser storage when the atom is first created for SSR", () => {
  const storage = vi.spyOn(window, "localStorage", "get");
  expect(createStore().get(createTodoDefaultCategoryAtom("user:team"))).toBeUndefined();
  expect(storage).not.toHaveBeenCalled();
});
