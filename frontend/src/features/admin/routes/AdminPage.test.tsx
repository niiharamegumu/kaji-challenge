import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppProviders } from "../../../app/providers";
import { appQueryClient } from "../../../shared/query/queryClient";
import { sessionAtom } from "../../../state/session";
import { AdminPenaltiesPage } from "./AdminPenaltiesPage";
import { AdminTasksPage } from "./AdminTasksPage";

const mockPostTask = vi.fn();
const mockPatchTask = vi.fn();
const mockListTasks = vi.fn();
const mockListPenaltyRules = vi.fn();
const mockPatchPenaltyRule = vi.fn();

vi.mock("../../../lib/api/generated/client", async () => {
  const actual = await vi.importActual<object>(
    "../../../lib/api/generated/client",
  );
  return {
    ...actual,
    TaskType: { daily: "daily", weekly: "weekly" },
    listTasks: (...args: unknown[]) => mockListTasks(...args),
    listPenaltyRules: (...args: unknown[]) => mockListPenaltyRules(...args),
    postTask: (...args: unknown[]) => mockPostTask(...args),
    patchTask: (...args: unknown[]) => mockPatchTask(...args),
    deleteTask: vi.fn(),
    postPenaltyRule: vi.fn(),
    patchPenaltyRule: (...args: unknown[]) => mockPatchPenaltyRule(...args),
    deletePenaltyRule: vi.fn(),
    postTeamInvite: vi.fn().mockResolvedValue({ data: { code: "INVITE1" } }),
    postTeamJoin: vi.fn(),
  };
});

describe("AdminTasksPage", () => {
  const LoginStateSetter = () => {
    const setSession = useSetAtom(sessionAtom);
    useEffect(() => {
      setSession({ authenticated: true });
    }, [setSession]);
    return null;
  };

  beforeEach(() => {
    appQueryClient.clear();
    mockPostTask.mockReset();
    mockPatchTask.mockReset();
    mockListTasks.mockReset();
    mockListPenaltyRules.mockReset();
    mockPatchPenaltyRule.mockReset();
    mockListTasks.mockResolvedValue({ data: { items: [] } });
    mockListPenaltyRules.mockResolvedValue({ data: { items: [] } });
  });

  afterEach(() => {
    cleanup();
  });

  const renderPage = () =>
    render(
      <AppProviders>
        <LoginStateSetter />
        <AdminTasksPage />
      </AppProviders>,
    );

  const renderPenaltiesPage = () =>
    render(
      <AppProviders>
        <LoginStateSetter />
        <AdminPenaltiesPage />
      </AppProviders>,
    );

  it("posts task from task manager", async () => {
    mockPostTask.mockResolvedValue({ data: {} });
    const user = userEvent.setup();

    renderPage();

    await user.click(await screen.findByRole("button", { name: "タスク追加" }));

    await waitFor(() => {
      expect(mockPostTask).toHaveBeenCalled();
    });
  });

  it("starts editing with current values and saves task title/notes", async () => {
    mockListTasks.mockResolvedValue({
      data: {
        items: [
          {
            id: "task-1",
            teamId: "team-1",
            title: "皿洗い",
            notes: "夜ごはんの後",
            type: "daily",
            penaltyPoints: 2,
            assigneeUserId: undefined,
            requiredCompletionsPerWeek: 1,
            createdAt: "2026-02-01T00:00:00Z",
            updatedAt: "2026-02-01T00:00:00Z",
          },
        ],
      },
    });
    mockPatchTask.mockResolvedValue({ data: {} });
    const user = userEvent.setup();

    renderPage();

    const editButton = await screen.findByRole("button", { name: "編集" });
    const card = editButton.closest("li");
    if (card == null) {
      throw new Error("task card not found");
    }
    await user.click(editButton);

    const titleInput = await within(card).findByLabelText("タイトル");
    const notesInput = within(card).getByLabelText("メモ");
    expect(titleInput).toHaveValue("皿洗い");
    expect(notesInput).toHaveValue("夜ごはんの後");

    await user.clear(titleInput);
    await user.type(titleInput, "台所掃除");
    await user.clear(notesInput);
    await user.type(notesInput, "寝る前");
    await user.click(within(card).getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(mockPatchTask).toHaveBeenCalledWith("task-1", {
        title: "台所掃除",
        notes: "寝る前",
      });
    });
  });

  it("allows clearing task notes", async () => {
    mockListTasks.mockResolvedValue({
      data: {
        items: [
          {
            id: "task-2",
            teamId: "team-1",
            title: "洗濯",
            notes: "夜",
            type: "daily",
            penaltyPoints: 1,
            assigneeUserId: undefined,
            requiredCompletionsPerWeek: 1,
            createdAt: "2026-02-01T00:00:00Z",
            updatedAt: "2026-02-01T00:00:00Z",
          },
        ],
      },
    });
    mockPatchTask.mockResolvedValue({ data: {} });
    const user = userEvent.setup();

    renderPage();

    const editButton = await screen.findByRole("button", { name: "編集" });
    const card = editButton.closest("li");
    if (card == null) {
      throw new Error("task card not found");
    }
    await user.click(editButton);

    const notesInput = await within(card).findByLabelText("メモ");
    await user.clear(notesInput);
    await user.click(within(card).getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(mockPatchTask).toHaveBeenCalledWith("task-2", {
        title: "洗濯",
        notes: "",
      });
    });
  });

  it("does not save when title is blank", async () => {
    mockListTasks.mockResolvedValue({
      data: {
        items: [
          {
            id: "task-3",
            teamId: "team-1",
            title: "ゴミ出し",
            notes: "",
            type: "daily",
            penaltyPoints: 1,
            assigneeUserId: undefined,
            requiredCompletionsPerWeek: 1,
            createdAt: "2026-02-01T00:00:00Z",
            updatedAt: "2026-02-01T00:00:00Z",
          },
        ],
      },
    });
    const user = userEvent.setup();

    renderPage();
    const editButton = await screen.findByRole("button", { name: "編集" });
    const card = editButton.closest("li");
    if (card == null) {
      throw new Error("task card not found");
    }
    await user.click(editButton);
    const titleInput = await within(card).findByLabelText("タイトル");
    await user.clear(titleInput);
    await user.type(titleInput, "   ");
    const saveButton = within(card).getByRole("button", { name: "保存" });
    expect(saveButton).toBeDisabled();
    expect(mockPatchTask).not.toHaveBeenCalled();
  });

  it("cancels editing and restores display state", async () => {
    mockListTasks.mockResolvedValue({
      data: {
        items: [
          {
            id: "task-4",
            teamId: "team-1",
            title: "風呂掃除",
            notes: "土曜",
            type: "daily",
            penaltyPoints: 1,
            assigneeUserId: undefined,
            requiredCompletionsPerWeek: 1,
            createdAt: "2026-02-01T00:00:00Z",
            updatedAt: "2026-02-01T00:00:00Z",
          },
        ],
      },
    });
    const user = userEvent.setup();

    renderPage();
    const editButton = await screen.findByRole("button", { name: "編集" });
    const card = editButton.closest("li");
    if (card == null) {
      throw new Error("task card not found");
    }
    await user.click(editButton);
    const titleInput = await within(card).findByLabelText("タイトル");
    await user.clear(titleInput);
    await user.type(titleInput, "変更後");
    await user.click(within(card).getByRole("button", { name: "キャンセル" }));

    await waitFor(() => {
      expect(screen.getByText("風呂掃除")).toBeInTheDocument();
    });
    expect(mockPatchTask).not.toHaveBeenCalled();
    const displayCard = screen.getByText("風呂掃除").closest("li");
    if (displayCard == null) {
      throw new Error("card not found");
    }
    expect(
      within(displayCard).queryByLabelText("タイトル"),
    ).not.toBeInTheDocument();
  });

  it("starts editing penalty rule with current name and saves", async () => {
    mockListPenaltyRules.mockResolvedValue({
      data: {
        items: [
          {
            id: "rule-1",
            teamId: "team-1",
            threshold: 10,
            name: "ルールA",
            description: undefined,
            deletedAt: null,
            createdAt: "2026-02-01T00:00:00Z",
            updatedAt: "2026-02-01T00:00:00Z",
          },
        ],
      },
    });
    mockPatchPenaltyRule.mockResolvedValue({ data: {} });
    const user = userEvent.setup();

    renderPenaltiesPage();

    const editButton = await screen.findByRole("button", { name: "編集" });
    const card = editButton.closest("li");
    if (card == null) {
      throw new Error("rule card not found");
    }
    await user.click(editButton);

    const nameInput = await within(card).findByLabelText("ルール名");
    expect(nameInput).toHaveValue("ルールA");

    await user.clear(nameInput);
    await user.type(nameInput, "ルールB");
    await user.click(within(card).getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(mockPatchPenaltyRule).toHaveBeenCalledWith("rule-1", {
        name: "ルールB",
      });
    });
  });

  it("does not save penalty rule when name is blank", async () => {
    mockListPenaltyRules.mockResolvedValue({
      data: {
        items: [
          {
            id: "rule-2",
            teamId: "team-1",
            threshold: 12,
            name: "ルールC",
            description: undefined,
            deletedAt: null,
            createdAt: "2026-02-01T00:00:00Z",
            updatedAt: "2026-02-01T00:00:00Z",
          },
        ],
      },
    });
    const user = userEvent.setup();

    renderPenaltiesPage();

    const editButton = await screen.findByRole("button", { name: "編集" });
    const card = editButton.closest("li");
    if (card == null) {
      throw new Error("rule card not found");
    }
    await user.click(editButton);

    const nameInput = await within(card).findByLabelText("ルール名");
    await user.clear(nameInput);
    await user.type(nameInput, "   ");

    const saveButton = within(card).getByRole("button", { name: "保存" });
    expect(saveButton).toBeDisabled();
    expect(mockPatchPenaltyRule).not.toHaveBeenCalled();
  });

  it("cancels penalty rule edit", async () => {
    mockListPenaltyRules.mockResolvedValue({
      data: {
        items: [
          {
            id: "rule-3",
            teamId: "team-1",
            threshold: 8,
            name: "ルールD",
            description: undefined,
            deletedAt: null,
            createdAt: "2026-02-01T00:00:00Z",
            updatedAt: "2026-02-01T00:00:00Z",
          },
        ],
      },
    });
    const user = userEvent.setup();

    renderPenaltiesPage();

    const editButton = await screen.findByRole("button", { name: "編集" });
    const card = editButton.closest("li");
    if (card == null) {
      throw new Error("rule card not found");
    }
    await user.click(editButton);

    const nameInput = await within(card).findByLabelText("ルール名");
    await user.clear(nameInput);
    await user.type(nameInput, "変更後");
    await user.click(within(card).getByRole("button", { name: "キャンセル" }));

    await waitFor(() => {
      expect(screen.getByText("ルールD")).toBeInTheDocument();
    });
    expect(mockPatchPenaltyRule).not.toHaveBeenCalled();
    const displayCard = screen.getByText("ルールD").closest("li");
    if (displayCard == null) {
      throw new Error("card not found");
    }
    expect(
      within(displayCard).queryByLabelText("ルール名"),
    ).not.toBeInTheDocument();
  });
});
