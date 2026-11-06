import { describe, expect, it } from "vitest";

import { restoreTodoOrder } from "./restoreTodoOrder";

describe("restoreTodoOrder", () => {
  const items = ["hidden-start", "a", "hidden-middle", "b", "hidden-end"].map((id) => ({ id }));

  it("preserves hidden items' positions when reordering a filtered list", () => {
    expect(restoreTodoOrder(items, ["b", "a"])).toEqual([
      "hidden-start",
      "b",
      "hidden-middle",
      "a",
      "hidden-end",
    ]);
  });

  it("keeps the order when the selected category is empty", () => {
    expect(restoreTodoOrder(items, [])).toEqual(items.map((item) => item.id));
  });

  it("ignores an item removed during the drag and keeps newly arrived items in place", () => {
    expect(restoreTodoOrder(items, ["deleted", "b", "a"])).toEqual([
      "hidden-start",
      "b",
      "hidden-middle",
      "a",
      "hidden-end",
    ]);
  });
});
