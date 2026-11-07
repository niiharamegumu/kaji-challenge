import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { THEME_BOOTSTRAP_SCRIPT, THEME_STORAGE_KEY } from "../../../shared/state/theme";
import { ThemeSync } from "../../../shared/state/ThemeSync";
import { ThemeSettings } from "./ThemeSettings";

let dark = false;
let media: EventTarget;
const settings = () => (
  <Provider>
    <ThemeSync />
    <ThemeSettings />
  </Provider>
);
const mode = (name: string) => screen.getByRole("radio", { name });
const themeColor = () =>
  document.querySelector('meta[name="theme-color"]')?.getAttribute("content");
const changeSystem = (value: boolean) =>
  act(() => {
    dark = value;
    media.dispatchEvent(new Event("change"));
  });

beforeEach(() => {
  window.localStorage.clear();
  dark = false;
  media = new EventTarget();
  Object.defineProperty(media, "matches", { get: () => dark, configurable: true });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
  document.head.innerHTML = '<meta name="theme-color" content="#f6f4ef">';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

it("defaults to system without writing storage and follows live OS changes", () => {
  render(settings());
  expect(mode("システム")).toBeChecked();
  expect(screen.getByRole("group", { name: "表示モード" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "表示モードの説明" }));
  expect(screen.getByRole("dialog", { name: "表示モードの説明" })).toHaveTextContent(
    /端末の設定.*このブラウザーに保存/,
  );
  fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  expect(themeColor()).toBe("#f6f4ef");
  changeSystem(true);
  expect(themeColor()).toBe("#191b19");
  expect(mode("システム")).toBeChecked();
  changeSystem(false);
  expect(themeColor()).toBe("#f6f4ef");
});

it.each([
  ["ダーク", "dark", "#191b19"],
  ["ライト", "light", "#f6f4ef"],
])(
  "persists %s, ignores OS changes while explicit, and restores after remount",
  (label, value, color) => {
    const view = render(settings());
    fireEvent.click(mode(label));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(value);
    expect(document.documentElement).toHaveAttribute("data-theme", value);
    changeSystem(true);
    changeSystem(false);
    expect(themeColor()).toBe(color);
    view.unmount();
    render(settings());
    expect(mode(label)).toBeChecked();
    expect(themeColor()).toBe(color);
    changeSystem(true);
    fireEvent.click(mode("システム"));
    expect(themeColor()).toBe("#191b19");
    changeSystem(false);
    expect(themeColor()).toBe("#f6f4ef");
  },
);

it.each(["", "null", '"dark"', "invalid", "<script>"])(
  "falls back safely for stored %s",
  (value) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
    dark = true;
    render(settings());
    expect(mode("システム")).toBeChecked();
    expect(themeColor()).toBe("#191b19");
  },
);

it("synchronizes other tabs, key deletion and clear, but ignores sessionStorage", () => {
  render(settings());
  window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
  fireEvent(
    window,
    new StorageEvent("storage", { key: THEME_STORAGE_KEY, storageArea: window.sessionStorage }),
  );
  expect(mode("システム")).toBeChecked();
  fireEvent(
    window,
    new StorageEvent("storage", { key: THEME_STORAGE_KEY, storageArea: window.localStorage }),
  );
  expect(mode("ダーク")).toBeChecked();
  window.localStorage.removeItem(THEME_STORAGE_KEY);
  fireEvent(
    window,
    new StorageEvent("storage", { key: THEME_STORAGE_KEY, storageArea: window.localStorage }),
  );
  expect(mode("システム")).toBeChecked();
  fireEvent.click(mode("ライト"));
  window.localStorage.clear();
  fireEvent(window, new StorageEvent("storage", { key: null, storageArea: window.localStorage }));
  expect(mode("システム")).toBeChecked();
});

it("applies an unsaved selection, keeps it through an OS change and allows retry", () => {
  render(settings());
  vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw new Error("Full");
  });
  fireEvent.click(mode("ダーク"));
  expect(mode("ダーク")).toBeChecked();
  expect(screen.getByRole("alert")).toHaveTextContent("保存できませんでした");
  changeSystem(false);
  expect(themeColor()).toBe("#191b19");
  fireEvent.click(mode("ライト"));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
});

it("keeps system mode usable when storage access is blocked", () => {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new Error("Blocked");
  });
  dark = true;
  render(settings());
  expect(mode("システム")).toBeChecked();
  expect(themeColor()).toBe("#191b19");
  fireEvent.click(mode("ライト"));
  expect(themeColor()).toBe("#f6f4ef");
  expect(screen.getByRole("alert")).toBeVisible();
});

it("does not read browser storage during server rendering and cleans up listeners", () => {
  const read = vi.spyOn(Storage.prototype, "getItem");
  expect(renderToString(settings())).toContain("システム");
  expect(read).not.toHaveBeenCalled();
  const remove = vi.spyOn(media, "removeEventListener");
  const view = render(settings());
  view.unmount();
  expect(remove).toHaveBeenCalledWith("change", expect.any(Function));
});

it.each([
  [null, true, "system", "#191b19"],
  ["invalid", false, "system", "#f6f4ef"],
  ["dark", false, "dark", "#191b19"],
  ["light", true, "light", "#f6f4ef"],
])("bootstraps stored %s before React mounts", (stored, systemDark, preference, color) => {
  dark = systemDark;
  if (stored !== null) window.localStorage.setItem(THEME_STORAGE_KEY, stored);
  window.eval(THEME_BOOTSTRAP_SCRIPT);
  expect(document.documentElement).toHaveAttribute("data-theme", preference);
  expect(themeColor()).toBe(color);
  render(settings());
  expect(document.documentElement).toHaveAttribute("data-theme", preference);
  expect(themeColor()).toBe(color);
});
