/** Reorder only the requested items that still exist, leaving other items in their slots. */
export function reorderItems<T extends { id: string }>(items: T[], orderedIds: string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const requested = new Set(orderedIds);
  const ordered: T[] = [];
  for (const id of requested) {
    const item = byId.get(id);
    if (item) ordered.push(item);
  }
  let index = 0;
  return items.map((item) => (requested.has(item.id) ? ordered[index++] : item));
}
