import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppProviders } from "../../../app/providers";
import { SuspenseQueryBoundary } from "../../../shared/components/SuspenseQueryBoundary";
import { appQueryClient } from "../../../shared/query/queryClient";
import { teamMembersQueryOptions } from "../../../shared/query/teamMembersQuery";
import { renderWithProviders } from "../../../test/render";
import { SettingsPage } from "./SettingsPage";

const mockGetMe = vi.fn();
const mockGetTeamCurrentMembers = vi.fn();
const mockGetTeamCurrentInvite = vi.fn();
const mockGetPushSubscriptionsMe = vi.fn();
const mockPostTeamInvite = vi.fn();
const mockPostTeamJoin = vi.fn();
const mockPostTeamLeave = vi.fn();
const mockPatchMeNickname = vi.fn();
const mockPatchMeColor = vi.fn();
const mockPatchTeamCurrent = vi.fn();
const mockPostPushSubscription = vi.fn();
const mockDeletePushSubscription = vi.fn();
const mockOutletContext = vi.fn();
const mockWaitForPWARegistration = vi.fn();
const mockServiceWorkerAddEventListener = vi.fn();
const mockServiceWorkerRemoveEventListener = vi.fn();

function createNotificationMock(
  permission: "default" | "granted",
): Pick<typeof Notification, "permission" | "requestPermission"> {
  return {
    permission,
    requestPermission: vi.fn().mockResolvedValue(permission),
  };
}

vi.mock("../../../app/pwa-register", async () => {
  const actual = await vi.importActual<object>("../../../app/pwa-register");
  return {
    ...actual,
    waitForPWARegistration: () => mockWaitForPWARegistration(),
  };
});

vi.mock("../../../shared/router/navigation", async () => {
  const actual = await vi.importActual<object>("../../../shared/router/navigation");
  return {
    ...actual,
    useOutletContext: () => mockOutletContext(),
  };
});

vi.mock("../../../lib/api/operations", async () => {
  const actual = await vi.importActual<object>("../../../lib/api/operations");
  return {
    ...actual,
    getMe: (...args: unknown[]) => mockGetMe(...args),
    getTeamCurrentMembers: (...args: unknown[]) => mockGetTeamCurrentMembers(...args),
    getTeamCurrentInvite: (...args: unknown[]) => mockGetTeamCurrentInvite(...args),
    getPushSubscriptionsMe: (...args: unknown[]) => mockGetPushSubscriptionsMe(...args),
    postTeamInvite: (...args: unknown[]) => mockPostTeamInvite(...args),
    postTeamJoin: (...args: unknown[]) => mockPostTeamJoin(...args),
    postTeamLeave: (...args: unknown[]) => mockPostTeamLeave(...args),
    patchMeNickname: (...args: unknown[]) => mockPatchMeNickname(...args),
    patchMeColor: (...args: unknown[]) => mockPatchMeColor(...args),
    patchTeamCurrent: (...args: unknown[]) => mockPatchTeamCurrent(...args),
    postPushSubscription: (...args: unknown[]) => mockPostPushSubscription(...args),
    deletePushSubscription: (...args: unknown[]) => mockDeletePushSubscription(...args),
  };
});

describe("SettingsPage", () => {
  beforeEach(() => {
    appQueryClient.clear();
    mockGetMe.mockReset();
    mockGetTeamCurrentMembers.mockReset();
    mockGetTeamCurrentInvite.mockReset();
    mockGetPushSubscriptionsMe.mockReset();
    mockPostTeamInvite.mockReset();
    mockPostTeamJoin.mockReset();
    mockPostTeamLeave.mockReset();
    mockPatchMeNickname.mockReset();
    mockPatchMeColor.mockReset();
    mockPatchTeamCurrent.mockReset();
    mockPostPushSubscription.mockReset();
    mockDeletePushSubscription.mockReset();
    mockWaitForPWARegistration.mockReset();
    mockServiceWorkerAddEventListener.mockReset();
    mockServiceWorkerRemoveEventListener.mockReset();

    mockGetTeamCurrentMembers.mockResolvedValue({ data: { items: [] } });
    mockGetTeamCurrentInvite.mockResolvedValue({ data: null });
    mockGetPushSubscriptionsMe.mockResolvedValue({
      data: { items: [], vapidPublicKey: "BElfakeKey" },
    });
    mockPostTeamInvite.mockResolvedValue({
      data: {
        code: "NEWCODE",
        teamId: "team-1",
        expiresAt: "2026-02-28T00:00:00Z",
      },
    });
    mockPostTeamJoin.mockResolvedValue({ data: {} });
    mockPostTeamLeave.mockResolvedValue({ data: {} });
    mockPatchMeNickname.mockResolvedValue({ data: {} });
    mockPatchMeColor.mockResolvedValue({ data: {} });
    mockPatchTeamCurrent.mockResolvedValue({ data: {} });
    mockPostPushSubscription.mockResolvedValue({ data: {} });
    mockDeletePushSubscription.mockResolvedValue({ data: {} });
    mockOutletContext.mockReturnValue({
      currentUserId: "u1",
      currentTeamId: "team-1",
      currentTeamName: "Team A",
      displayName: "Owner",
    });
    vi.stubGlobal("Notification", createNotificationMock("default"));
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    Object.defineProperty(window, "PushManager", {
      writable: true,
      value: class PushManagerMock {},
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener: mockServiceWorkerAddEventListener,
        removeEventListener: mockServiceWorkerRemoveEventListener,
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("does not fetch me on settings page render", async () => {
    render(
      <AppProviders>
        <SuspenseQueryBoundary errorMessage="テスト用エラー">
          <SettingsPage />
        </SuspenseQueryBoundary>
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "設定" })).toBeInTheDocument();
    });
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("reuses the member list already fetched by the header", async () => {
    await appQueryClient.ensureQueryData(teamMembersQueryOptions);
    renderWithProviders(<SettingsPage />);

    await screen.findByRole("heading", { name: "設定" });
    expect(mockGetTeamCurrentMembers).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "ニックネーム",
      value: "新しい名前",
      mutation: mockPatchMeNickname,
      payload: { nickname: "新しい名前" },
    },
    {
      label: "表示カラー",
      value: "#123456",
      mutation: mockPatchMeColor,
      payload: { colorHex: "#123456" },
    },
    {
      label: "チーム名",
      value: "新しいチーム",
      mutation: mockPatchTeamCurrent,
      payload: { name: "新しいチーム" },
    },
  ])(
    "keeps $label on save failure and allows retry without duplicate submissions",
    async ({ label, value, mutation, payload }) => {
      let rejectSave!: (reason: Error) => void;
      mutation.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectSave = reject;
          }),
      );
      const user = userEvent.setup();
      renderWithProviders(<SettingsPage />);
      const input = await screen.findByRole("textbox", { name: label });
      const field = input.parentElement!;
      await user.clear(input);
      await user.type(input, value);
      await user.click(within(field).getByRole("button", { name: "保存" }));

      const saving = within(field).getByRole("button", { name: "保存中..." });
      expect(input).toBeDisabled();
      expect(saving).toBeDisabled();
      await user.click(saving);
      expect(mutation).toHaveBeenCalledTimes(1);

      await act(async () => rejectSave(new Error("save failed")));
      await waitFor(() => expect(input).toBeEnabled());
      expect(input).toHaveValue(value);
      await user.click(within(field).getByRole("button", { name: "保存" }));
      await waitFor(() => expect(mutation).toHaveBeenCalledTimes(2));
      expect(mutation).toHaveBeenLastCalledWith(payload);
      await waitFor(() => expect(input).toBeEnabled());
    },
  );

  it("discards a team-name draft when moving to another team with the same name", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(<SettingsPage />);
    const input = await screen.findByRole("textbox", { name: "チーム名" });
    await user.clear(input);
    await user.type(input, "編集中");
    mockOutletContext.mockReturnValue({
      currentUserId: "u1",
      currentTeamId: "team-2",
      currentTeamName: "Team A",
      displayName: "Owner",
    });
    rerender(<SettingsPage />);
    expect(input).toHaveValue("Team A");
  });

  it("does not re-fetch current invite immediately after creating invite", async () => {
    const user = userEvent.setup();

    render(
      <AppProviders>
        <SuspenseQueryBoundary errorMessage="テスト用エラー">
          <SettingsPage />
        </SuspenseQueryBoundary>
      </AppProviders>,
    );

    await user.click(await screen.findByRole("button", { name: "招待コードを発行" }));

    await waitFor(() => {
      expect(mockPostTeamInvite).toHaveBeenCalledTimes(1);
    });
    expect(mockGetTeamCurrentInvite).toHaveBeenCalledTimes(1);
  });

  it("clears nickname by saving an empty value", async () => {
    mockGetTeamCurrentMembers.mockResolvedValue({
      data: {
        items: [
          {
            userId: "u1",
            displayName: "Owner",
            nickname: "にっく",
            effectiveName: "にっく",
            colorHex: "#111111",
            joinedAt: "2026-02-24T00:00:00Z",
            role: "owner",
          },
        ],
      },
    });
    const user = userEvent.setup();

    render(
      <AppProviders>
        <SuspenseQueryBoundary errorMessage="テスト用エラー">
          <SettingsPage />
        </SuspenseQueryBoundary>
      </AppProviders>,
    );

    const accountHeading = await screen.findByRole("heading", {
      name: "アカウント設定",
    });
    const accountCard = accountHeading.closest("article");
    if (accountCard == null) {
      throw new Error("account card not found");
    }
    const nicknameInput = within(accountCard).getByLabelText("ニックネーム");
    await waitFor(() => {
      expect(nicknameInput).toHaveValue("にっく");
    });
    await user.clear(nicknameInput);
    await waitFor(() => {
      expect(nicknameInput).toHaveValue("");
    });

    const nicknameField = nicknameInput.closest("div");
    if (nicknameField == null) {
      throw new Error("nickname field container not found");
    }
    const saveButton = within(nicknameField).getByRole("button", {
      name: "保存",
    });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockPatchMeNickname).toHaveBeenCalledWith({ nickname: "" });
    });
  });

  it("does not keep dirty nickname draft after current user changes", async () => {
    mockGetTeamCurrentMembers.mockResolvedValue({
      data: {
        items: [
          {
            userId: "u1",
            displayName: "Owner",
            nickname: "にっく",
            effectiveName: "にっく",
            colorHex: "#111111",
            joinedAt: "2026-02-24T00:00:00Z",
            role: "owner",
          },
          {
            userId: "u2",
            displayName: "Partner",
            nickname: "ぱーとなー",
            effectiveName: "ぱーとなー",
            colorHex: "#222222",
            joinedAt: "2026-02-24T00:00:00Z",
            role: "member",
          },
        ],
      },
    });
    const user = userEvent.setup();

    const { rerender } = render(
      <AppProviders>
        <SuspenseQueryBoundary errorMessage="テスト用エラー">
          <SettingsPage />
        </SuspenseQueryBoundary>
      </AppProviders>,
    );

    const accountHeading = await screen.findByRole("heading", {
      name: "アカウント設定",
    });
    const accountCard = accountHeading.closest("article");
    if (accountCard == null) {
      throw new Error("account card not found");
    }
    const nicknameInput = within(accountCard).getByLabelText("ニックネーム");
    await waitFor(() => {
      expect(nicknameInput).toHaveValue("にっく");
    });
    await user.clear(nicknameInput);
    await user.type(nicknameInput, "編集中");
    expect(nicknameInput).toHaveValue("編集中");

    mockOutletContext.mockReturnValue({
      currentUserId: "u2",
      currentTeamId: "team-2",
      currentTeamName: "Team B",
      displayName: "Partner",
    });

    rerender(
      <AppProviders>
        <SuspenseQueryBoundary errorMessage="テスト用エラー">
          <SettingsPage />
        </SuspenseQueryBoundary>
      </AppProviders>,
    );

    await waitFor(() => {
      expect(within(accountCard).getByLabelText("ニックネーム")).toHaveValue("ぱーとなー");
    });
  });
});
