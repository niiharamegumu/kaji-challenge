import { atom } from "jotai";

export type TodoCategorySelection =
  | { kind: "all" }
  | { kind: "unclassified" }
  | { kind: "category"; id: string };

export const ALL_TODO_CATEGORIES: TodoCategorySelection = { kind: "all" };

export function todoDefaultCategoryStorageKey(identityKey: string) {
  return `kaji:todo-default-category:v1:${identityKey}`;
}

function parseSelection(value: unknown): TodoCategorySelection {
  if (typeof value !== "object" || value === null) return ALL_TODO_CATEGORIES;
  if ("kind" in value) {
    if (value.kind === "all" || value.kind === "unclassified") return { kind: value.kind };
    if (
      value.kind === "category" &&
      "id" in value &&
      typeof value.id === "string" &&
      value.id.length > 0 &&
      value.id.length <= 128
    ) {
      return { kind: "category", id: value.id };
    }
  }
  return ALL_TODO_CATEGORIES;
}

export function createTodoDefaultCategoryAtom(identityKey: string | null) {
  const key = identityKey === null ? null : todoDefaultCategoryStorageKey(identityKey);
  const read = () => {
    try {
      return key === null
        ? ALL_TODO_CATEGORIES
        : parseSelection(JSON.parse(window.localStorage.getItem(key) ?? "null"));
    } catch {
      return ALL_TODO_CATEGORIES;
    }
  };
  const valueAtom = atom<TodoCategorySelection | undefined>(undefined);
  valueAtom.onMount = (setValue) => {
    // Match SSR and hydration, then load only this user's current team preference.
    setValue(read());
    const onStorage = (event: StorageEvent) => {
      if (key === null || (event.key !== key && event.key !== null)) return;
      try {
        if (event.storageArea === window.localStorage) setValue(read());
      } catch {
        // Keep the current value if storage becomes unavailable.
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  };
  return atom(
    (get) => get(valueAtom),
    (_get, set, selection: TodoCategorySelection) => {
      if (key === null) return false;
      const value = parseSelection(selection);
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        set(valueAtom, value);
        return true;
      } catch {
        return false;
      }
    },
  );
}
