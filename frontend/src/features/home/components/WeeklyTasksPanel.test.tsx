import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TaskOverviewWeeklyTask } from "../../../lib/api/generated/client";
import { WeeklyTasksPanel } from "./WeeklyTasksPanel";

function buildWeeklyTask(
  overrides: Partial<TaskOverviewWeeklyTask> = {},
): TaskOverviewWeeklyTask {
  return {
    task: {
      id: "task-1",
      teamId: "team-1",
      title: "掃除機",
      notes: "リビング中心",
      type: "weekly",
      penaltyPoints: 1,
      requiredCompletionsPerWeek: 3,
      createdAt: "2026-02-01T00:00:00Z",
      updatedAt: "2026-02-01T00:00:00Z",
    },
    weekCompletedCount: 1,
    requiredCompletionsPerWeek: 3,
    completionSlots: [
      { slot: 1, actor: { userId: "u1", effectiveName: "めぐ" } },
      { slot: 2, actor: null },
      { slot: 3, actor: null },
    ],
    ...overrides,
  };
}

describe("WeeklyTasksPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("calls decrement when tapping the left side", async () => {
    const user = userEvent.setup();
    const onDecrement = vi.fn();
    const onIncrement = vi.fn();

    render(
      <WeeklyTasksPanel
        items={[buildWeeklyTask()]}
        elapsedDaysInWeek={3}
        weeklyProgress="0/1"
        onToggle={vi.fn()}
        onIncrement={onIncrement}
        onDecrement={onDecrement}
      />,
    );

    await user.click(screen.getByRole("button", { name: "掃除機 を1減らす" }));

    expect(onDecrement).toHaveBeenCalledWith("task-1");
    expect(onIncrement).not.toHaveBeenCalled();
  });

  it("calls increment when tapping the right side", async () => {
    const user = userEvent.setup();
    const onDecrement = vi.fn();
    const onIncrement = vi.fn();

    render(
      <WeeklyTasksPanel
        items={[buildWeeklyTask()]}
        elapsedDaysInWeek={3}
        weeklyProgress="0/1"
        onToggle={vi.fn()}
        onIncrement={onIncrement}
        onDecrement={onDecrement}
      />,
    );

    await user.click(screen.getByRole("button", { name: "掃除機 を1増やす" }));

    expect(onIncrement).toHaveBeenCalledWith("task-1");
    expect(onDecrement).not.toHaveBeenCalled();
  });

  it("shows disabled states at lower/upper bounds", () => {
    render(
      <WeeklyTasksPanel
        items={[
          buildWeeklyTask({
            task: {
              ...buildWeeklyTask().task,
              id: "lower",
              title: "下限タスク",
            },
            weekCompletedCount: 0,
          }),
          buildWeeklyTask({
            task: {
              ...buildWeeklyTask().task,
              id: "upper",
              title: "上限タスク",
            },
            weekCompletedCount: 3,
          }),
        ]}
        elapsedDaysInWeek={2}
        weeklyProgress="1/2"
        onToggle={vi.fn()}
        onIncrement={vi.fn()}
        onDecrement={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "下限タスク を1減らす" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "上限タスク を1増やす" }),
    ).toBeDisabled();
    expect(screen.getByTestId("weekly-decrement-icon-lower")).toHaveClass(
      "bg-stone-300",
    );
    expect(screen.getByTestId("weekly-increment-icon-upper")).toHaveClass(
      "bg-stone-300",
    );
    expect(screen.getByTestId("weekly-decrement-icon-upper")).toHaveClass(
      "bg-stone-900",
    );
    expect(screen.getByTestId("weekly-increment-icon-lower")).toHaveClass(
      "bg-stone-900",
    );
  });

  it("keeps single-completion task behavior unchanged", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <WeeklyTasksPanel
        items={[
          buildWeeklyTask({
            task: {
              ...buildWeeklyTask().task,
              id: "single",
              title: "単発タスク",
              requiredCompletionsPerWeek: 1,
            },
            requiredCompletionsPerWeek: 1,
            weekCompletedCount: 0,
          }),
        ]}
        elapsedDaysInWeek={1}
        weeklyProgress="0/1"
        onToggle={onToggle}
        onIncrement={vi.fn()}
        onDecrement={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /単発タスク/ }));

    expect(onToggle).toHaveBeenCalledWith("single");
    expect(
      screen.queryByRole("button", { name: "単発タスク を1減らす" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "単発タスク を1増やす" }),
    ).not.toBeInTheDocument();
  });
});
