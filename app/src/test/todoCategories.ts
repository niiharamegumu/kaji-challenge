import type { TodoCategory } from "../contracts/models";

// Stable IDs for fixture lookup only. Production code never derives identity from a name.
const categories = new Map<string, TodoCategory>();
export function categoryFixture(name: string): TodoCategory {
  const existing = categories.get(name);
  if (existing) return existing;
  const category = { id: crypto.randomUUID(), name };
  categories.set(name, category);
  return category;
}
export const categoryOrderFixture = (...names: (string | null)[]) =>
  names.map((name) => (name === null ? null : categoryFixture(name)));
export const categoryIdFixture = (name: string) => categoryFixture(name).id;
