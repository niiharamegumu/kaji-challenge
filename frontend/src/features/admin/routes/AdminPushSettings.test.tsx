import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

describe("AdminPushSettings", () => {
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

  it("sends notification test with a unique tag", async () => {
    const user = userEvent.setup();
    const showNotification = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("Notification", createNotificationMock("granted"));
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    mockWaitForPWARegistration.mockResolvedValue({
      active: null,
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
      await screen.findByRole("button", { name: "プッシュ通知をテスト" }),
    );

    await waitFor(() => {
      expect(showNotification).toHaveBeenCalledTimes(1);
    });
    expect(showNotification).toHaveBeenCalledWith(
      "家事チャレンジ",
      expect.objectContaining({
        body: "プッシュ通知テストです。表示できれば OS 側の通知機能は正常です。",
        badge: "/icons/pwa-64x64.png",
        data: {
          slotKind: "local_test",
          teamId: "",
          url: "/",
        },
        icon: "/icons/pwa-192x192.png",
        renotify: true,
        tag: expect.stringMatching(/^kaji-challenge-local-test:\d+$/),
        timestamp: expect.any(Number),
      }),
    );
  });
});
