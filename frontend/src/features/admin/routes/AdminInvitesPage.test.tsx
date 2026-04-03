import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppProviders } from "../../../app/providers";
import { SuspenseQueryBoundary } from "../../../shared/components/SuspenseQueryBoundary";
import { appQueryClient } from "../../../shared/query/queryClient";
import { AdminInvitesPage } from "./AdminInvitesPage";

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

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<object>("react-router-dom");
  return {
    ...actual,
    useOutletContext: () => mockOutletContext(),
  };
});

vi.mock("../../../lib/api/generated/client", async () => {
  const actual = await vi.importActual<object>(
    "../../../lib/api/generated/client",
  );
  return {
    ...actual,
    getMe: (...args: unknown[]) => mockGetMe(...args),
    getTeamCurrentMembers: (...args: unknown[]) =>
      mockGetTeamCurrentMembers(...args),
    getTeamCurrentInvite: (...args: unknown[]) =>
      mockGetTeamCurrentInvite(...args),
    getPushSubscriptionsMe: (...args: unknown[]) =>
      mockGetPushSubscriptionsMe(...args),
    postTeamInvite: (...args: unknown[]) => mockPostTeamInvite(...args),
    postTeamJoin: (...args: unknown[]) => mockPostTeamJoin(...args),
    postTeamLeave: (...args: unknown[]) => mockPostTeamLeave(...args),
    patchMeNickname: (...args: unknown[]) => mockPatchMeNickname(...args),
    patchMeColor: (...args: unknown[]) => mockPatchMeColor(...args),
    patchTeamCurrent: (...args: unknown[]) => mockPatchTeamCurrent(...args),
    postPushSubscription: (...args: unknown[]) =>
      mockPostPushSubscription(...args),
    deletePushSubscription: (...args: unknown[]) =>
      mockDeletePushSubscription(...args),
  };
});

describe("AdminInvitesPage", () => {
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
          <AdminInvitesPage />
        </SuspenseQueryBoundary>
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "設定" })).toBeInTheDocument();
    });
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("does not re-fetch current invite immediately after creating invite", async () => {
    const user = userEvent.setup();

    render(
      <AppProviders>
        <SuspenseQueryBoundary errorMessage="テスト用エラー">
          <AdminInvitesPage />
        </SuspenseQueryBoundary>
      </AppProviders>,
    );

    await user.click(
      await screen.findByRole("button", { name: "招待コードを発行" }),
    );

    await waitFor(() => {
      expect(mockPostTeamInvite).toHaveBeenCalledTimes(1);
    });
    expect(mockGetTeamCurrentInvite).toHaveBeenCalledTimes(1);
  });

  it("does not sync browser subscription automatically on render", async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal("Notification", createNotificationMock("granted"));
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    mockWaitForPWARegistration.mockResolvedValue({
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue({
          endpoint: "https://example.com/push/sub-1",
          getKey: vi.fn((name: string) => {
            if (name === "p256dh") {
              return encoder.encode("hello").buffer;
            }
            if (name === "auth") {
              return encoder.encode("world").buffer;
            }
            return null;
          }),
        }),
      },
    });

    render(
      <AppProviders>
        <SuspenseQueryBoundary errorMessage="テスト用エラー">
          <AdminInvitesPage />
        </SuspenseQueryBoundary>
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "設定" })).toBeInTheDocument();
    });
    expect(mockPostPushSubscription).not.toHaveBeenCalled();
  });

  it("does not sync browser subscription outside standalone pwa", async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal("Notification", createNotificationMock("granted"));
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    mockWaitForPWARegistration.mockResolvedValue({
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue({
          endpoint: "https://example.com/push/sub-standalone",
          getKey: vi.fn((name: string) => {
            if (name === "p256dh") {
              return encoder.encode("hello").buffer;
            }
            if (name === "auth") {
              return encoder.encode("world").buffer;
            }
            return null;
          }),
        }),
      },
    });

    render(
      <AppProviders>
        <SuspenseQueryBoundary errorMessage="テスト用エラー">
          <AdminInvitesPage />
        </SuspenseQueryBoundary>
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "設定" })).toBeInTheDocument();
    });
    expect(mockPostPushSubscription).not.toHaveBeenCalled();
  });

  it("sends local test notification with unique tag and inspects notifications", async () => {
    const user = userEvent.setup();
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const getNotifications = vi.fn().mockResolvedValue([
      {
        tag: "kaji-challenge-local-test:123",
        title: "家事チャレンジ",
      },
    ]);
    const postMessage = vi.fn();

    vi.stubGlobal("Notification", createNotificationMock("granted"));
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    mockWaitForPWARegistration.mockResolvedValue({
      active: { postMessage },
      getNotifications,
      installing: null,
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
      },
      scope: "https://kaji.megumu.me/",
      showNotification,
      waiting: null,
    });

    render(
      <AppProviders>
        <SuspenseQueryBoundary errorMessage="テスト用エラー">
          <AdminInvitesPage />
        </SuspenseQueryBoundary>
      </AppProviders>,
    );

    await user.click(
      await screen.findByRole("button", { name: "ローカル通知テスト" }),
    );

    await waitFor(() => {
      expect(showNotification).toHaveBeenCalledTimes(1);
    });
    expect(postMessage).toHaveBeenCalledWith({ type: "GET_SW_VERSION" });
    expect(getNotifications).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledWith(
      "家事チャレンジ",
      expect.objectContaining({
        body: "ローカル通知テストです。表示できれば OS 側の通知機能は正常です。",
        renotify: true,
        tag: expect.stringMatching(/^kaji-challenge-local-test:\d+$/),
        timestamp: expect.any(Number),
      }),
    );
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
          <AdminInvitesPage />
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
          <AdminInvitesPage />
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
      currentTeamName: "Team B",
      displayName: "Partner",
    });

    rerender(
      <AppProviders>
        <SuspenseQueryBoundary errorMessage="テスト用エラー">
          <AdminInvitesPage />
        </SuspenseQueryBoundary>
      </AppProviders>,
    );

    await waitFor(() => {
      expect(within(accountCard).getByLabelText("ニックネーム")).toHaveValue(
        "ぱーとなー",
      );
    });
  });
});
