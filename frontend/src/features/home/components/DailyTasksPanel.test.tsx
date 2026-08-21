import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TaskOverviewDailyTask } from "../../../lib/api/generated/client";
import { DailyTasksPanel } from "./DailyTasksPanel";

function buildDailyTask(
  id: string,
  title: string,
  completedToday: boolean,
): TaskOverviewDailyTask {
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
    completedBy: completedToday
      ? { userId: "user-1", effectiveName: "めぐ" }
      : null,
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
      />,
    );

    expect(
      screen.getByRole("heading", { name: "日間タスク" }),
    ).toBeInTheDocument();

    expect(
      screen.getByText("件数", { selector: "dt" }).nextElementSibling,
    ).toHaveTextContent("3件");
    expect(
      screen.getByText("完了", { selector: "dt" }).nextElementSibling,
    ).toHaveTextContent("1件");
    expect(
      screen.getByText("未完了", { selector: "dt" }).nextElementSibling,
    ).toHaveTextContent("2件");
  });

  it("shows zero counts and the empty state when there are no tasks", () => {
    render(<DailyTasksPanel items={[]} onToggle={vi.fn()} />);

    expect(screen.getAllByText("0件")).toHaveLength(3);
    expect(screen.getByText("日間タスクはありません。")).toBeInTheDocument();
  });
});
