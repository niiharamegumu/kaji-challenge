import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import { Provider, useAtomValue } from "jotai";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  defaultUserPreferences,
  type UserPreferences,
  type UpdateUserPreferences,
} from "../../contracts/user-preferences";
import { ThemeSettings } from "../../features/settings/components/ThemeSettings";
import { TodoCompletionSettings } from "../../features/settings/components/TodoCompletionSettings";
import { TodoDefaultCategorySettings } from "../../features/todos/components/TodoDefaultCategorySettings";
import { resolvedData } from "../../test/apiMock";
import { ThemeSync } from "../../shared/state/ThemeSync";
import { todoCompletionDelayAtom } from "../../shared/state/todoCompletionDelay";
import { userPreferencesStorageKey } from "../../shared/state/userPreferencesCache";
import { UserPreferencesProvider } from "../../shared/query/UserPreferencesProvider";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  initialize: vi.fn(),
  patch: vi.fn(),
  categories: vi.fn(),
}));
vi.mock("../../lib/api/operations", async () => ({
  ...(await vi.importActual<object>("../../lib/api/operations")),
  getMePreferences: api.get,
  initializeMePreferences: api.initialize,
  patchMePreferences: api.patch,
  listTodoCategories: api.categories,
}));
let client: QueryClient;
let stored: UserPreferences | null;
const categoryId = crypto.randomUUID();
function AppliedDelay() {
  return <output data-testid="delay">{useAtomValue(todoCompletionDelayAtom)}</output>;
}
function Scene({ userId = "user", teamId = "team" }: { userId?: string; teamId?: string }) {
  return (
    <StrictMode>
      <QueryClientProvider client={client}>
        <Provider>
          <ThemeSync />
          <UserPreferencesProvider key={userId + ":" + teamId} userId={userId} teamId={teamId}>
            <ThemeSettings />
            <TodoCompletionSettings />
            <TodoDefaultCategorySettings />
            <AppliedDelay />
          </UserPreferencesProvider>
        </Provider>
      </QueryClientProvider>
    </StrictMode>
  );
}
const mode = (name: string) => screen.getByRole("radio", { name });
const delay = () => screen.getByRole("combobox", { name: "ToDo完了の取り消し猶予" });
const category = () => screen.getByRole("combobox", { name: "最初に表示するToDoカテゴリー" });
const ready = () => waitFor(() => expect(delay()).toBeEnabled());
const readCache = (id = "user") =>
  JSON.parse(localStorage.getItem(userPreferencesStorageKey(id)) ?? "null");
beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  stored = { ...defaultUserPreferences };
  api.get.mockImplementation(async () => resolvedData(stored));
  api.initialize.mockImplementation(async (value: UserPreferences) =>
    resolvedData((stored ??= value)),
  );
  api.patch.mockImplementation(async (patch: UpdateUserPreferences) =>
    resolvedData((stored = { ...stored!, ...patch })),
  );
  api.categories.mockResolvedValue(
    resolvedData({ categories: [null, { id: categoryId, name: "買い物" }] }),
  );
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  localStorage.clear();
});

it("paints the user's cache, then adopts D1 without changing this browser's theme", async () => {
  localStorage.setItem("kaji:theme:v1", "dark");
  localStorage.setItem(
    userPreferencesStorageKey("user"),
    JSON.stringify({ ...defaultUserPreferences, todoCompletionDelayMs: 5000 }),
  );
  let resolve!: (value: unknown) => void;
  api.get.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<Scene />);
  await waitFor(() => expect(mode("ダーク")).toBeChecked());
  expect(delay()).toBeDisabled();
  expect(mode("ライト")).toBeEnabled();
  expect(screen.getByTestId("delay")).toHaveTextContent("5000");
  const remote: UserPreferences = {
    todoCompletionDelayMs: 1000,
    defaultTodoCategory: { kind: "category", id: categoryId },
  };
  await act(async () => resolve(resolvedData(remote)));
  await ready();
  expect(mode("ダーク")).toBeChecked();
  expect(category()).toHaveValue("category:" + categoryId);
  expect(screen.getByTestId("delay")).toHaveTextContent("1000");
  expect(readCache()).toEqual(remote);
  expect(api.initialize).not.toHaveBeenCalled();
  expect(api.patch).not.toHaveBeenCalled();
});

it("migrates the legacy settings only when D1 is empty, including StrictMode and a second browser", async () => {
  stored = null;
  localStorage.setItem("kaji:theme:v1", "dark");
  localStorage.setItem("kaji:todo-completion-delay-ms:v1", "1700");
  localStorage.setItem(
    "kaji:todo-default-category:v1:user:team",
    JSON.stringify({ kind: "category", id: categoryId }),
  );
  const view = render(<Scene />);
  await ready();
  expect(api.initialize).toHaveBeenCalledTimes(1);
  expect(stored).toEqual({
    todoCompletionDelayMs: 2000,
    defaultTodoCategory: { kind: "category", id: categoryId },
  });
  view.unmount();
  client.clear();
  localStorage.clear();
  localStorage.setItem("kaji:theme:v1", "light");
  render(<Scene />);
  await ready();
  expect(mode("ライト")).toBeChecked();
  expect(api.initialize).toHaveBeenCalledTimes(1);
});

it("saves both ToDo fields independently and preserves the server values after remount", async () => {
  const view = render(<Scene />);
  await ready();
  fireEvent.change(delay(), { target: { value: "5000" } });
  await ready();
  fireEvent.change(category(), { target: { value: "category:" + categoryId } });
  await ready();
  expect(api.patch.mock.calls.map(([patch]) => patch)).toEqual([
    { todoCompletionDelayMs: 5000 },
    { defaultTodoCategory: { kind: "category", id: categoryId } },
  ]);
  view.unmount();
  client.clear();
  localStorage.clear();
  render(<Scene />);
  await ready();
  expect(delay()).toHaveValue("5000");
  expect(category()).toHaveValue("category:" + categoryId);
});

it("blocks duplicate saves, rolls back failed optimistic values and allows a manual retry", async () => {
  let reject!: (reason: Error) => void;
  api.patch.mockImplementationOnce(
    () =>
      new Promise((_done, fail) => {
        reject = fail;
      }),
  );
  render(<Scene />);
  await ready();
  fireEvent.change(delay(), { target: { value: "5000" } });
  await waitFor(() => expect(delay()).toHaveValue("5000"));
  expect(delay()).toBeDisabled();
  expect(readCache().todoCompletionDelayMs).toBe(3000);
  fireEvent.change(delay(), { target: { value: "1000" } });
  await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
  await act(async () => reject(new Error("offline")));
  await ready();
  expect(delay()).toHaveValue("3000");
  expect(screen.getAllByRole("alert")[0]).toHaveTextContent("保存できませんでした");
  expect(api.patch).toHaveBeenCalledTimes(1);
  fireEvent.change(delay(), { target: { value: "5000" } });
  await ready();
  expect(readCache().todoCompletionDelayMs).toBe(5000);
  expect(screen.queryAllByRole("alert")).toHaveLength(0);
});

it("saves to D1 when localStorage access is blocked", async () => {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new Error("blocked");
  });
  render(<Scene />);
  await ready();
  fireEvent.change(delay(), { target: { value: "5000" } });
  await ready();
  expect(stored?.todoCompletionDelayMs).toBe(5000);
  expect(delay()).toHaveValue("5000");
  expect(screen.queryAllByRole("alert")).toHaveLength(0);
});

it("refreshes from D1 on focus, reconnect and this user's cache event", async () => {
  render(<Scene />);
  await ready();
  stored = { ...defaultUserPreferences, todoCompletionDelayMs: 1000 };
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await waitFor(() => expect(delay()).toHaveValue("1000"));
  stored = { ...stored, todoCompletionDelayMs: 5000 };
  act(() => {
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  await waitFor(() => expect(delay()).toHaveValue("5000"));
  stored = { ...stored, defaultTodoCategory: { kind: "unclassified" } };
  fireEvent(
    window,
    new StorageEvent("storage", {
      key: userPreferencesStorageKey("user"),
      storageArea: localStorage,
    }),
  );
  await waitFor(() => expect(category()).toHaveValue("unclassified"));
});

it("discards a previous account's delayed save response and never migrates its browser-wide cache", async () => {
  let resolve!: (value: unknown) => void;
  api.patch.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  localStorage.setItem("kaji:theme:v1", "dark");
  const view = render(<Scene />);
  await ready();
  fireEvent.change(delay(), { target: { value: "5000" } });
  await waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
  stored = null;
  view.rerender(<Scene userId="other" />);
  await ready();
  await act(async () =>
    resolve(resolvedData({ ...defaultUserPreferences, todoCompletionDelayMs: 5000 })),
  );
  expect(mode("ダーク")).toBeChecked();
  expect(delay()).toHaveValue("3000");
  expect(readCache("other")).toEqual(defaultUserPreferences);
  expect(readCache("user")).toEqual(defaultUserPreferences);
});

it("keeps cached ToDo settings on read failure while local theme stays editable", async () => {
  localStorage.setItem("kaji:theme:v1", "dark");
  localStorage.setItem(
    userPreferencesStorageKey("user"),
    JSON.stringify({ ...defaultUserPreferences, todoCompletionDelayMs: 5000 }),
  );
  api.get.mockRejectedValueOnce(new Error("offline"));
  render(<Scene />);
  await waitFor(() =>
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("取得できませんでした"),
  );
  expect(mode("ダーク")).toBeChecked();
  expect(delay()).toBeDisabled();
  expect(delay()).toHaveValue("5000");
  fireEvent.click(mode("ライト"));
  expect(mode("ライト")).toBeChecked();
  expect(localStorage.getItem("kaji:theme:v1")).toBe("light");
  expect(api.patch).not.toHaveBeenCalled();
  expect(api.initialize).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "再取得" })[0]);
  await ready();
  expect(mode("ライト")).toBeChecked();
  expect(delay()).toHaveValue("3000");
});

it("does not read storage or call the API during server rendering", () => {
  const read = vi.spyOn(Storage.prototype, "getItem");
  expect(renderToString(<Scene />)).toContain("表示モード");
  expect(read).not.toHaveBeenCalled();
  expect(api.get).not.toHaveBeenCalled();
});
