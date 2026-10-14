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
const slider = () => screen.getByRole("slider", { name: "ToDo完了の取り消し猶予" });

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

it("shows the default, units, bounds and browser-only scope", () => {
  render(settings());
  expect(slider()).toHaveValue("3000");
  expect(slider()).toHaveAttribute("min", "100");
  expect(slider()).toHaveAttribute("max", "5000");
  expect(slider()).toHaveAttribute("step", "100");
  expect(slider()).toHaveAttribute("aria-valuetext", "3.0秒");
  expect(screen.getByText("3.0秒", { exact: true })).toBeVisible();
  expect(slider()).toHaveAccessibleDescription(
    /0.1秒刻み.*初期値は3.0秒.*このブラウザー.*次に完了するToDo/,
  );
  expect(screen.getByText("別の端末やブラウザーには引き継がれません。")).toBeVisible();
  expect(window.localStorage.getItem(storageKey)).toBeNull();
});

it.each([100, 1_700, 3_000, 5_000])("persists %sms and restores it in a fresh app", (value) => {
  const view = render(settings());
  fireEvent.change(slider(), { target: { value: String(value) } });
  // The unchanged default needs no write; all other values are stored as numeric milliseconds.
  if (value !== 3_000) expect(JSON.parse(window.localStorage.getItem(storageKey)!)).toBe(value);
  view.unmount();
  render(settings());
  expect(slider()).toHaveValue(String(value));
  expect(slider()).toHaveAttribute("aria-valuetext", `${(value / 1_000).toFixed(1)}秒`);
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
  "5001",
  "5100",
  "1e999",
])("rejects corrupt, out-of-range or off-step storage %s without rounding", (stored) => {
  window.localStorage.setItem(storageKey, stored);
  render(settings());
  expect(slider()).toHaveValue("3000");
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
  expect(slider()).toHaveValue("3000");
});

it("keeps an unsaved change usable and clears its warning after a successful retry", () => {
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  render(settings());
  fireEvent.change(slider(), { target: { value: "100" } });
  expect(slider()).toHaveValue("100");
  expect(screen.getByRole("alert")).toHaveTextContent("再読み込み後は保持されません");
  fireEvent.change(slider(), { target: { value: "200" } });
  expect(write).toHaveBeenCalledTimes(2);
  expect(window.localStorage.getItem(storageKey)).toBe("200");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("reacts to this localStorage key and clearing storage from another tab", () => {
  render(settings());
  const emitStorage = (key: string | null, storageArea = window.localStorage) =>
    act(() => window.dispatchEvent(new StorageEvent("storage", { key, storageArea })));
  window.localStorage.setItem(storageKey, "5000");
  emitStorage("unrelated");
  emitStorage(storageKey, window.sessionStorage);
  expect(slider()).toHaveValue("3000");
  emitStorage(storageKey);
  expect(slider()).toHaveValue("5000");
  window.localStorage.setItem(storageKey, "150");
  emitStorage(storageKey);
  expect(slider()).toHaveValue("3000");
  window.localStorage.setItem(storageKey, "100");
  emitStorage(storageKey);
  expect(slider()).toHaveValue("100");
  window.localStorage.clear();
  emitStorage(null);
  expect(slider()).toHaveValue("3000");
});

it("does not access browser storage during SSR and hydrates before loading the saved value", () => {
  const storage = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new Error("Browser storage must not be accessed during SSR");
  });
  const markup = renderToString(settings());
  expect(storage).not.toHaveBeenCalled();
  storage.mockRestore();
  window.localStorage.setItem(storageKey, "100");
  const container = document.createElement("div");
  container.innerHTML = markup;
  document.body.appendChild(container);
  expect(container.querySelector("input")).toHaveValue("3000");
  const onRecoverableError = vi.fn();
  render(settings(), { container, hydrate: true, onRecoverableError });
  expect(onRecoverableError).not.toHaveBeenCalled();
  expect(slider()).toHaveValue("100");
});
