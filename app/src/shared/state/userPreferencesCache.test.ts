import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultUserPreferences } from "../../contracts/user-preferences";
import {
  readLegacyUserPreferences,
  readUserPreferencesCache,
  userPreferencesStorageKey,
  writeUserPreferencesCache,
} from "./userPreferencesCache";

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
it("isolates caches per user and validates cached values", () => {
  writeUserPreferencesCache("first", { ...defaultUserPreferences, todoCompletionDelayMs: 5000 });
  expect(readUserPreferencesCache("first")?.todoCompletionDelayMs).toBe(5000);
  expect(readUserPreferencesCache("second")).toBeNull();
  for (const value of [
    "broken",
    "null",
    "[]",
    JSON.stringify({ ...defaultUserPreferences, theme: "dark" }),
    JSON.stringify({ ...defaultUserPreferences, todoCompletionDelayMs: 8000 }),
  ]) {
    localStorage.setItem(userPreferencesStorageKey("first"), value);
    expect(readUserPreferencesCache("first")).toBeNull();
  }
});
it("claims browser-wide legacy values once and imports only the current user's old category", () => {
  const id = crypto.randomUUID();
  localStorage.setItem("kaji:theme:v1", "dark");
  localStorage.setItem("kaji:todo-completion-delay-ms:v1", "5000");
  localStorage.setItem(
    "kaji:todo-default-category:v1:second:team",
    JSON.stringify({ kind: "category", id }),
  );
  expect(readLegacyUserPreferences("first", "team")).toMatchObject({
    todoCompletionDelayMs: 5000,
  });
  expect(readLegacyUserPreferences("second", "team")).toEqual({
    ...defaultUserPreferences,
    defaultTodoCategory: { kind: "category", id },
  });
  writeUserPreferencesCache("second", defaultUserPreferences);
  expect(readLegacyUserPreferences("first", "team").todoCompletionDelayMs).toBe(5000);
  expect(localStorage.getItem("kaji:theme:v1")).toBe("dark");
  expect(readUserPreferencesCache("second")).not.toHaveProperty("theme");
});
it.each([
  [100, 1000],
  [900, 1000],
  [1400, 1000],
  [1500, 2000],
  [1700, 2000],
  [2400, 2000],
  [2500, 3000],
  [3500, 4000],
  [4500, 5000],
  [5000, 5000],
])("migrates old %sms to %sms without rewriting the legacy key", (old, expected) => {
  localStorage.setItem("kaji:todo-completion-delay-ms:v1", String(old));
  expect(readLegacyUserPreferences("first", "team").todoCompletionDelayMs).toBe(expected);
  expect(localStorage.getItem("kaji:todo-completion-delay-ms:v1")).toBe(String(old));
});
it.each([
  "broken",
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
  "5001",
  "5100",
  "1e999",
])("ignores invalid legacy delay %s", (value) => {
  localStorage.setItem("kaji:todo-completion-delay-ms:v1", value);
  expect(readLegacyUserPreferences("first", "team").todoCompletionDelayMs).toBe(3000);
});
it.each([
  "broken",
  "null",
  "[]",
  '{"kind":"unknown"}',
  '{"kind":"category"}',
  '{"kind":"category","id":1}',
])("ignores invalid category %s", (value) => {
  localStorage.setItem("kaji:todo-default-category:v1:first:team", value);
  expect(readLegacyUserPreferences("first", "team").defaultTodoCategory).toEqual({ kind: "all" });
});
it("does not throw when caching a server-confirmed save fails", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("full");
  });
  expect(() => writeUserPreferencesCache("first", defaultUserPreferences)).not.toThrow();
  expect(readLegacyUserPreferences("first", "team")).toEqual(defaultUserPreferences);
});
