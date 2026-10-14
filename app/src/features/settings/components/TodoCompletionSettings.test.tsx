import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TODO_COMPLETION_DELAY_STORAGE_KEY as storageKey } from "../../../shared/state/todoCompletionDelay";
import { TodoCompletionSettings } from "./TodoCompletionSettings";

const settings = () => (
  <Provider>
    <TodoCompletionSettings />
  </Provider>
);
const select = () => screen.getByRole("combobox", { name: "ToDo完了の取り消し猶予" });

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

it("shows the default, five whole-second options and browser-only scope", () => {
  render(settings());
  expect(select()).toHaveValue("3000");
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
    "1秒",
    "2秒",
    "3秒",
    "4秒",
    "5秒",
  ]);
  expect(screen.getByRole("option", { selected: true })).toHaveTextContent("3秒");
  expect(select()).toHaveAccessibleDescription(
    /1〜5秒.*初期値は3秒.*このブラウザー.*次に完了するToDo/,
  );
  expect(screen.getByText("別の端末やブラウザーには引き継がれません。")).toBeVisible();
  expect(window.localStorage.getItem(storageKey)).toBeNull();
});

it.each([1_000, 2_000, 3_000, 4_000, 5_000])(
  "persists %sms and restores it in a fresh app",
  (value) => {
    const view = render(settings());
    fireEvent.change(select(), { target: { value: String(value) } });
    expect(JSON.parse(window.localStorage.getItem(storageKey)!)).toBe(value);
    view.unmount();
    render(settings());
    expect(select()).toHaveValue(String(value));
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent(`${value / 1_000}秒`);
  },
);

it.each([
  [100, 1_000],
  [400, 1_000],
  [500, 1_000],
  [900, 1_000],
  [1_400, 1_000],
  [1_500, 2_000],
  [1_700, 2_000],
  [2_400, 2_000],
  [2_500, 3_000],
  [3_400, 3_000],
  [3_500, 4_000],
  [4_400, 4_000],
  [4_500, 5_000],
  [4_900, 5_000],
])("restores legacy %sms as %sms without rewriting storage", (stored, normalized) => {
  window.localStorage.setItem(storageKey, String(stored));
  render(settings());
  expect(select()).toHaveValue(String(normalized));
  expect(window.localStorage.getItem(storageKey)).toBe(String(stored));
});

it.each([
  "broken",
  "",
  "null",
  "true",
  '"100"',
  "{}",
  "[]",
  "0",
  "-100",
  "99",
  "100.5",
  "150",
  "1499",
  "1500.5",
  "5001",
  "5100",
  "1e999",
])("rejects corrupt, out-of-range or off-step storage %s without rounding", (stored) => {
  window.localStorage.setItem(storageKey, stored);
  render(settings());
  expect(select()).toHaveValue("3000");
});

it.each(["getter", "read"])("uses the default when the storage %s throws", (failure) => {
  if (failure === "getter") {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
  } else {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
  }
  render(settings());
  expect(select()).toHaveValue("3000");
});

it("keeps an unsaved change usable and clears its warning after a successful retry", () => {
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  render(settings());
  fireEvent.change(select(), { target: { value: "1000" } });
  expect(select()).toHaveValue("1000");
  expect(screen.getByRole("alert")).toHaveTextContent("再読み込み後は保持されません");
  fireEvent.change(select(), { target: { value: "2000" } });
  expect(write).toHaveBeenCalledTimes(2);
  expect(window.localStorage.getItem(storageKey)).toBe("2000");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("reacts to this localStorage key and clearing storage from another tab", () => {
  render(settings());
  const emitStorage = (key: string | null, storageArea = window.localStorage) =>
    act(() => window.dispatchEvent(new StorageEvent("storage", { key, storageArea })));
  window.localStorage.setItem(storageKey, "5000");
  emitStorage("unrelated");
  emitStorage(storageKey, window.sessionStorage);
  expect(select()).toHaveValue("3000");
  emitStorage(storageKey);
  expect(select()).toHaveValue("5000");
  window.localStorage.setItem(storageKey, "150");
  emitStorage(storageKey);
  expect(select()).toHaveValue("3000");
  window.localStorage.setItem(storageKey, "1700");
  emitStorage(storageKey);
  expect(select()).toHaveValue("2000");
  window.localStorage.setItem(storageKey, "100");
  emitStorage(storageKey);
  expect(select()).toHaveValue("1000");
  window.localStorage.removeItem(storageKey);
  emitStorage(storageKey);
  expect(select()).toHaveValue("3000");
  window.localStorage.setItem(storageKey, "4000");
  emitStorage(storageKey);
  expect(select()).toHaveValue("4000");
  window.localStorage.clear();
  emitStorage(null);
  expect(select()).toHaveValue("3000");
});

it("does not access browser storage during SSR and hydrates before loading the saved value", () => {
  const storage = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new Error("Browser storage must not be accessed during SSR");
  });
  const markup = renderToString(settings());
  expect(storage).not.toHaveBeenCalled();
  storage.mockRestore();
  window.localStorage.setItem(storageKey, "1700");
  const container = document.createElement("div");
  container.innerHTML = markup;
  document.body.appendChild(container);
  expect(container.querySelector("select")).toHaveValue("3000");
  const onRecoverableError = vi.fn();
  render(settings(), { container, hydrate: true, onRecoverableError });
  expect(onRecoverableError).not.toHaveBeenCalled();
  expect(select()).toHaveValue("2000");
});
