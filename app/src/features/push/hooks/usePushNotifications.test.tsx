import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryKeys } from "../../../shared/query/queryKeys";
import { usePushNotifications } from "./usePushNotifications";

const mocks = vi.hoisted(() => ({
  wait: vi.fn(),
  ensure: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../../../app/pwa-register", () => ({
  waitForPWARegistration: mocks.wait,
  ensureLatestPWARegistration: mocks.ensure,
}));
vi.mock("../../../lib/api/operations", () => ({
  getPushSubscriptionsMe: mocks.get,
  postPushSubscription: mocks.post,
  deletePushSubscription: mocks.remove,
  PushPlatform: { ios_safari_pwa: "ios_safari_pwa" },
}));
vi.mock("../lib/pushClient", () => ({
  isPushSupported: () => true,
  isStandalonePWA: () => true,
  urlBase64ToUint8Array: () => new Uint8Array([1]),
  serializePushSubscription: (subscription: { endpoint: string }) => ({
    endpoint: subscription.endpoint,
    keys: { p256dh: "public", auth: "auth" },
  }),
}));

const data = { items: [], vapidPublicKey: "public" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(queryKeys.pushSubscriptions, data);
  const status = vi.fn();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => usePushNotifications(status), { wrapper }), status, client };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue({ data });
  mocks.post.mockResolvedValue({ data: {} });
  vi.stubGlobal("Notification", {
    permission: "default",
    requestPermission: vi.fn().mockResolvedValue("granted"),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each(["permission", "registration", "lookup", "subscribe"] as const)(
  "does not register a subscription after leaving during %s",
  async (stage) => {
    const pending = deferred<unknown>();
    const subscription = { endpoint: "https://push.example.test/endpoint" };
    const registration = {
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn().mockResolvedValue(subscription),
      },
    };
    mocks.ensure.mockResolvedValue(registration);
    const step =
      stage === "permission"
        ? vi.mocked(Notification.requestPermission)
        : stage === "registration"
          ? mocks.ensure
          : stage === "lookup"
            ? registration.pushManager.getSubscription
            : registration.pushManager.subscribe;
    step.mockReturnValueOnce(pending.promise as Promise<NotificationPermission>);
    const hook = mount();
    let operation!: Promise<void>;
    act(() => {
      operation = hook.result.current.enableCurrentDevice();
    });
    await waitFor(() => expect(step).toHaveBeenCalledOnce());
    hook.unmount();
    await act(async () => {
      pending.resolve(
        stage === "permission" ? "granted" : stage === "registration" ? registration : subscription,
      );
      await operation;
    });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(hook.status).not.toHaveBeenCalled();
    hook.client.clear();
  },
);

it("keeps a pending permission flow working while mounted", async () => {
  const pending = deferred<NotificationPermission>();
  vi.mocked(Notification.requestPermission).mockReturnValueOnce(pending.promise);
  mocks.ensure.mockResolvedValue({
    pushManager: {
      getSubscription: vi
        .fn()
        .mockResolvedValue({ endpoint: "https://push.example.test/endpoint" }),
    },
  });
  const hook = mount();
  let operation!: Promise<void>;
  act(() => {
    operation = hook.result.current.enableCurrentDevice();
  });
  expect(mocks.post).not.toHaveBeenCalled();
  await act(async () => {
    pending.resolve("granted");
    await operation;
  });
  expect(mocks.post).toHaveBeenCalledOnce();
  expect(hook.status).toHaveBeenCalledWith("この端末のプッシュ通知をオンにしました。");
  hook.unmount();
  hook.client.clear();
});

it("reports a rejected initial browser subscription read without an unhandled rejection", async () => {
  vi.stubGlobal("Notification", { permission: "granted" });
  mocks.wait.mockResolvedValue({
    pushManager: { getSubscription: vi.fn().mockRejectedValue(new Error("unavailable")) },
  });
  const hook = mount();
  await waitFor(() =>
    expect(hook.status).toHaveBeenCalledWith(
      expect.stringContaining("購読情報の取得に失敗しました"),
    ),
  );
  hook.unmount();
  hook.client.clear();
});
