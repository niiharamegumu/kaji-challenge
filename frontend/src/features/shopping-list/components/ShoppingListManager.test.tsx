import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShoppingListManager } from "./ShoppingListManager";

type MockDragEndEvent = {
  active: { id: string };
  over: { id: string } | null;
};

type MockDndContextProps = {
  children: ReactNode;
  onDragEnd?: (event: MockDragEndEvent) => void;
};

type MockChildrenProps = {
  children: ReactNode;
};

let latestOnDragEnd: ((event: MockDragEndEvent) => void) | null = null;

afterEach(() => {
  cleanup();
});

vi.mock("@dnd-kit/core", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    DndContext: ({ children, onDragEnd }: MockDndContextProps) => {
      latestOnDragEnd = onDragEnd ?? null;
      return React.createElement("div", null, children);
    },
    KeyboardSensor: class {},
    PointerSensor: class {},
    TouchSensor: class {},
    closestCenter: vi.fn(),
    useSensor: vi.fn((sensor: unknown, options?: unknown) => ({
      sensor,
      options,
    })),
    useSensors: vi.fn((...sensors: unknown[]) => sensors),
  };
});

vi.mock("@dnd-kit/sortable", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    SortableContext: ({ children }: MockChildrenProps) =>
      React.createElement(React.Fragment, null, children),
    arrayMove: <T,>(items: T[], oldIndex: number, newIndex: number) => {
      const nextItems = [...items];
      const [moved] = nextItems.splice(oldIndex, 1);
      nextItems.splice(newIndex, 0, moved);
      return nextItems;
    },
    defaultAnimateLayoutChanges: vi.fn(() => true),
    sortableKeyboardCoordinates: vi.fn(),
    useSortable: vi.fn(() => ({
      attributes: {},
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      transition: null,
      isDragging: false,
    })),
    verticalListSortingStrategy: vi.fn(),
  };
});

vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: {
      toString: () => undefined,
    },
  },
}));

describe("ShoppingListManager", () => {
  it("linkifies only http and https URLs in notes", () => {
    render(
      <ShoppingListManager
        form={{ name: "", quantity: "", notes: "" }}
        items={[
          {
            id: "item-1",
            teamId: "team-1",
            name: "牛乳",
            quantity: null,
            notes:
              "公式 https://example.com/path?q=1 と <script>alert(1)</script> と javascript:alert(1)",
            position: 1,
            createdAt: "2026-03-01T00:00:00Z",
            updatedAt: "2026-03-01T00:00:00Z",
          },
        ]}
        isCreateOpen={false}
        isReordering={false}
        onCloseCreate={() => undefined}
        onFormChange={() => undefined}
        onOpenCreate={() => undefined}
        onCreate={async () => undefined}
        onDelete={() => undefined}
        onReorder={() => undefined}
        onUpdate={async () => undefined}
      />,
    );

    const link = screen.getByRole("link", {
      name: "https://example.com/path?q=1",
    });
    expect(link).toHaveAttribute("href", "https://example.com/path?q=1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(
      screen.getByText("<script>alert(1)</script>", { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "javascript:alert(1)" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "牛乳 をドラッグして並び替え" }),
    ).toBeInTheDocument();
  });

  it("reorders items from the drag-and-drop path", () => {
    const onReorder = vi.fn();
    const items = [
      {
        id: "item-1",
        teamId: "team-1",
        name: "牛乳",
        quantity: null,
        notes: null,
        position: 1,
        createdAt: "2026-03-01T00:00:00Z",
        updatedAt: "2026-03-01T00:00:00Z",
      },
      {
        id: "item-2",
        teamId: "team-1",
        name: "卵",
        quantity: null,
        notes: null,
        position: 2,
        createdAt: "2026-03-01T00:00:00Z",
        updatedAt: "2026-03-01T00:00:00Z",
      },
    ];

    const { rerender } = render(
      <ShoppingListManager
        form={{ name: "", quantity: "", notes: "" }}
        items={items}
        isCreateOpen={false}
        isReordering={false}
        onCloseCreate={() => undefined}
        onFormChange={() => undefined}
        onOpenCreate={() => undefined}
        onCreate={async () => undefined}
        onDelete={() => undefined}
        onReorder={onReorder}
        onUpdate={async () => undefined}
      />,
    );

    if (latestOnDragEnd == null) {
      throw new Error("drag handler was not registered");
    }

    act(() => {
      latestOnDragEnd?.({
        active: { id: "item-2" },
        over: { id: "item-1" },
      });
    });

    expect(onReorder).toHaveBeenCalledWith(["item-2", "item-1"]);

    rerender(
      <ShoppingListManager
        form={{ name: "", quantity: "", notes: "" }}
        items={items}
        isCreateOpen={false}
        isReordering
        onCloseCreate={() => undefined}
        onFormChange={() => undefined}
        onOpenCreate={() => undefined}
        onCreate={async () => undefined}
        onDelete={() => undefined}
        onReorder={onReorder}
        onUpdate={async () => undefined}
      />,
    );

    const currentShoppingSection = screen
      .getByRole("heading", { name: "現在の買い物" })
      .closest("article");
    if (currentShoppingSection == null) {
      throw new Error("current shopping section not found");
    }
    const list = within(currentShoppingSection).getByRole("list");
    const reorderedItems = within(list).getAllByRole("listitem");
    expect(within(reorderedItems[0]).getByText("卵")).toBeInTheDocument();
    expect(within(reorderedItems[1]).getByText("牛乳")).toBeInTheDocument();
  });
});
