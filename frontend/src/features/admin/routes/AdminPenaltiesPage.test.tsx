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
import { SuspenseQueryBoundary } from "../../../shared/components/SuspenseQueryBoundary";
import { appQueryClient } from "../../../shared/query/queryClient";
import { sessionAtom } from "../../../state/session";
import { AdminPenaltiesPage } from "./AdminPenaltiesPage";

const mockPostTask = vi.fn();
const mockPostPenaltyRule = vi.fn();
const mockPatchTask = vi.fn();
const mockDeleteTask = vi.fn();
const mockPostTasksReorder = vi.fn();
const mockListTasks = vi.fn();
const mockListPenaltyRules = vi.fn();
const mockPatchPenaltyRule = vi.fn();
const mockDeletePenaltyRule = vi.fn();

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
    deleteTask: (...args: unknown[]) => mockDeleteTask(...args),
    postTasksReorder: (...args: unknown[]) => mockPostTasksReorder(...args),
    postPenaltyRule: (...args: unknown[]) => mockPostPenaltyRule(...args),
    patchPenaltyRule: (...args: unknown[]) => mockPatchPenaltyRule(...args),
    deletePenaltyRule: (...args: unknown[]) => mockDeletePenaltyRule(...args),
    postTeamInvite: vi.fn().mockResolvedValue({ data: { code: "INVITE1" } }),
    postTeamJoin: vi.fn(),
  };
});

describe("AdminPenaltiesPage", () => {
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
    mockPostPenaltyRule.mockReset();
    mockPatchTask.mockReset();
    mockDeleteTask.mockReset();
    mockPostTasksReorder.mockReset();
    mockListTasks.mockReset();
    mockListPenaltyRules.mockReset();
    mockPatchPenaltyRule.mockReset();
    mockDeletePenaltyRule.mockReset();
    mockListTasks.mockResolvedValue({ data: { items: [] } });
    mockListPenaltyRules.mockResolvedValue({ data: { items: [] } });
    mockPostTasksReorder.mockResolvedValue({ data: { items: [] } });
  });

  afterEach(() => {
    cleanup();
  });

  const renderPenaltiesPage = () =>
    render(
      <AppProviders>
        <LoginStateSetter />
        <SuspenseQueryBoundary errorMessage="テスト用エラー">
          <AdminPenaltiesPage />
        </SuspenseQueryBoundary>
      </AppProviders>,
    );

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

  it("deletes penalty rule only after confirming in modal", async () => {
    mockListPenaltyRules.mockResolvedValue({
      data: {
        items: [
          {
            id: "rule-del-1",
            teamId: "team-1",
            threshold: 5,
            name: "誤タップ確認ルール",
            description: undefined,
            deletedAt: null,
            createdAt: "2026-02-01T00:00:00Z",
            updatedAt: "2026-02-01T00:00:00Z",
          },
        ],
      },
    });
    mockDeletePenaltyRule.mockResolvedValue({
      status: 204,
      data: {},
      headers: {},
    });
    const user = userEvent.setup();

    renderPenaltiesPage();

    await user.click(await screen.findByRole("button", { name: "削除" }));
    expect(mockDeletePenaltyRule).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));

    await waitFor(() => {
      expect(mockDeletePenaltyRule).toHaveBeenCalledWith("rule-del-1");
    });
  });

  it("resets penalty rule form fields after creating rule", async () => {
    mockPostPenaltyRule.mockResolvedValue({ data: {} });
    const user = userEvent.setup();

    renderPenaltiesPage();

    await user.click(await screen.findByRole("button", { name: "追加" }));
    const dialog = await screen.findByRole("dialog", {
      name: "ペナルティルールを追加",
    });
    expect(dialog).toBeInTheDocument();
    const dialogWithin = within(dialog);
    await user.type(
      await dialogWithin.findByLabelText("ルール名"),
      "減点10で通知",
    );
    await user.clear(dialogWithin.getByLabelText("発動しきい値"));
    await user.type(dialogWithin.getByLabelText("発動しきい値"), "10");
    await user.click(dialogWithin.getByRole("button", { name: "追加する" }));

    await waitFor(() => {
      expect(mockPostPenaltyRule).toHaveBeenCalledWith({
        name: "減点10で通知",
        threshold: 10,
      });
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "ペナルティルールを追加" }),
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "追加" }));
    const reopenedDialog = await screen.findByRole("dialog", {
      name: "ペナルティルールを追加",
    });
    const reopened = within(reopenedDialog);
    expect(reopened.getByLabelText("ルール名")).toHaveValue("");
    expect(reopened.getByLabelText("発動しきい値")).toHaveValue(1);
  });
});
