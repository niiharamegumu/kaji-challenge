import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TaskOverviewDailyTask } from "../../../lib/api/operations";
import { DailyTasksPanel } from "./DailyTasksPanel";

function buildDailyTask(id: string, title: string, completedToday: boolean): TaskOverviewDailyTask {
  return {
    task: {
      id,
      teamId: "team-1",
      title,
      type: "daily",
      penaltyPoints: 1,
      requiredCompletionsPerWeek: 1,
      sortKey: 1,
      createdAt: "2026-08-21T00:00:00Z",
      updatedAt: "2026-08-21T00:00:00Z",
    },
    completedToday,
    completedBy: completedToday ? { userId: "user-1", effectiveName: "めぐ" } : null,
  };
}

describe("DailyTasksPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the daily task title and completion summary", () => {
    render(
      <DailyTasksPanel
        items={[
          buildDailyTask("task-1", "掃除機", true),
          buildDailyTask("task-2", "洗濯", false),
          buildDailyTask("task-3", "食器洗い", false),
        ]}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "日間タスク" })).toBeInTheDocument();

    expect(screen.getByText("件数", { selector: "dt" }).nextElementSibling).toHaveTextContent(
      "3件",
    );
    expect(screen.getByText("完了", { selector: "dt" }).nextElementSibling).toHaveTextContent(
      "1件",
    );
    expect(screen.getByText("未完了", { selector: "dt" }).nextElementSibling).toHaveTextContent(
      "2件",
    );
  });

  it("shows zero counts and the empty state when there are no tasks", () => {
    render(<DailyTasksPanel items={[]} onToggle={vi.fn()} onToggleAll={vi.fn()} />);

    expect(screen.getAllByText("0件")).toHaveLength(3);
    expect(screen.getByText("日間タスクはありません。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "すべて完了" })).toBeDisabled();
  });

  it.each([
    [false, "すべて完了"],
    [true, "すべて未完了"],
  ])("offers the bulk action for all-completed=%s", (completed, label) => {
    const onToggleAll = vi.fn();
    const onToggle = vi.fn();
    render(
      <DailyTasksPanel
        items={[
          buildDailyTask("task-1", "掃除機", true),
          buildDailyTask("task-2", "洗濯", completed),
        ]}
        onToggle={onToggle}
        onToggleAll={onToggleAll}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(onToggleAll).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("blocks bulk changes while a daily task is saving, but not for weekly saves", () => {
    const onToggleAll = vi.fn();
    const props = {
      items: [buildDailyTask("task-1", "掃除機", false)],
      onToggle: vi.fn(),
      onToggleAll,
    };
    const { rerender } = render(<DailyTasksPanel {...props} pendingTaskIds={["task-1"]} />);
    const button = screen.getByRole("button", { name: "すべて完了" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(onToggleAll).not.toHaveBeenCalled();

    rerender(<DailyTasksPanel {...props} pendingTaskIds={["weekly-1"]} />);
    expect(button).toHaveAttribute("aria-disabled", "false");
  });

  it("keeps keyboard focus through a bulk save and ignores repeated Enter presses", async () => {
    const user = userEvent.setup();
    const onToggleAll = vi.fn();
    const props = { onToggle: vi.fn(), onToggleAll };
    const items = [buildDailyTask("task-1", "掃除機", false)];
    const { rerender } = render(<DailyTasksPanel {...props} items={items} />);
    const button = screen.getByRole("button", { name: "すべて完了" });
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onToggleAll).toHaveBeenCalledTimes(1);

    rerender(<DailyTasksPanel {...props} items={items} pendingTaskIds={["task-1"]} />);
    expect(button).not.toBeDisabled();
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onToggleAll).toHaveBeenCalledTimes(1);

    rerender(<DailyTasksPanel {...props} items={[buildDailyTask("task-1", "掃除機", true)]} />);
    expect(button).toHaveAccessibleName("すべて未完了");
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onToggleAll).toHaveBeenCalledTimes(2);
  });
});
