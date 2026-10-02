import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { MonthlyTaskStatusItem } from "../../../lib/api/operations";
import { PastTaskCompletionControl } from "./PastTaskCompletionControl";

afterEach(cleanup);

it.each(["daily", "weekly"] as const)(
  "keeps %s keyboard focus through saving without accepting another update",
  async (type) => {
    const item: MonthlyTaskStatusItem = {
      taskId: "task-1",
      title: "片付け",
      type,
      penaltyPoints: 1,
      completed: false,
      isDeleted: false,
      completionSlots: [{ slot: 1 }],
    };
    const onUpdate = vi.fn();
    const props = { item, targetDate: "2026-03-09", onUpdate };
    const view = render(<PastTaskCompletionControl {...props} isSaving={false} />);
    const user = userEvent.setup();
    const button = screen.getByRole("button");
    await user.click(button);
    expect(button).toHaveFocus();
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({
      taskId: item.taskId,
      targetDate: props.targetDate,
      type,
      action: type === "daily" ? "complete" : "increment",
    });

    view.rerender(<PastTaskCompletionControl {...props} isSaving />);
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("status")).toHaveTextContent("保存中…");
    await user.keyboard("{Enter}");
    await user.click(button);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    view.rerender(
      <PastTaskCompletionControl
        {...props}
        item={{
          ...item,
          completed: true,
          completionSlots: [
            {
              slot: 1,
              actor: { userId: "user-1", effectiveName: "花子", colorHex: "#228B22" },
            },
          ],
        }}
        isSaving={false}
      />,
    );
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-disabled", "false");
    await user.keyboard("{Enter}");
    expect(onUpdate).toHaveBeenLastCalledWith({
      taskId: item.taskId,
      targetDate: props.targetDate,
      type,
      action: "decrement",
    });
  },
);
