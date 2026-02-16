import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppProviders } from "../../../app/providers";
import { AdminPage } from "./AdminPage";

const mockPostTask = vi.fn();

vi.mock("../../../lib/api/generated/client", async () => {
  const actual = await vi.importActual<object>(
    "../../../lib/api/generated/client",
  );
  return {
    ...actual,
    TaskType: { daily: "daily", weekly: "weekly" },
    listTasks: vi.fn().mockResolvedValue({ data: { items: [] } }),
    listPenaltyRules: vi.fn().mockResolvedValue({ data: { items: [] } }),
    postTask: (...args: unknown[]) => mockPostTask(...args),
    patchTask: vi.fn(),
    deleteTask: vi.fn(),
    postPenaltyRule: vi.fn(),
    patchPenaltyRule: vi.fn(),
    deletePenaltyRule: vi.fn(),
    postTeamInvite: vi.fn().mockResolvedValue({ data: { code: "INVITE1" } }),
    postTeamJoin: vi.fn(),
  };
});

describe("AdminPage", () => {
  it("posts task from task manager", async () => {
    mockPostTask.mockResolvedValue({ data: {} });
    const user = userEvent.setup();

    render(
      <AppProviders>
        <AdminPage />
      </AppProviders>,
    );

    await user.click(await screen.findByRole("button", { name: "タスク追加" }));

    await waitFor(() => {
      expect(mockPostTask).toHaveBeenCalled();
    });
  });
});
