import { atom } from "jotai";

export const TODO_COMPLETION_DELAY_STORAGE_KEY = "kaji:todo-completion-delay-ms:v1";
export const DEFAULT_TODO_COMPLETION_DELAY_MS = 3_000;
export const MIN_TODO_COMPLETION_DELAY_MS = 100;
export const MAX_TODO_COMPLETION_DELAY_MS = 5_000;
export const TODO_COMPLETION_DELAY_STEP_MS = 100;

function validatedDelay(value: unknown): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_TODO_COMPLETION_DELAY_MS &&
    value <= MAX_TODO_COMPLETION_DELAY_MS &&
    value % TODO_COMPLETION_DELAY_STEP_MS === 0
    ? value
    : DEFAULT_TODO_COMPLETION_DELAY_MS;
}

function readDelay(): number {
  try {
    const stored = window.localStorage.getItem(TODO_COMPLETION_DELAY_STORAGE_KEY);
    return validatedDelay(stored === null ? null : JSON.parse(stored));
  } catch {
    return DEFAULT_TODO_COMPLETION_DELAY_MS;
  }
}

const delayValueAtom = atom(DEFAULT_TODO_COMPLETION_DELAY_MS);
delayValueAtom.onMount = (setValue) => {
  // Keep the server and first client render identical; storage is browser-only.
  setValue(readDelay());
  const onStorage = (event: StorageEvent) => {
    if (event.key !== TODO_COMPLETION_DELAY_STORAGE_KEY && event.key !== null) return;
    try {
      if (event.storageArea === window.localStorage) setValue(readDelay());
    } catch {
      // Storage can become unavailable while this page is open. Keep its current value.
    }
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
};

export const todoCompletionDelayAtom = atom(
  (get) => get(delayValueAtom),
  (_get, set, value: number) => {
    const delayMs = validatedDelay(value);
    set(delayValueAtom, delayMs);
    try {
      window.localStorage.setItem(TODO_COMPLETION_DELAY_STORAGE_KEY, JSON.stringify(delayMs));
      return true;
    } catch {
      return false;
    }
  },
);
