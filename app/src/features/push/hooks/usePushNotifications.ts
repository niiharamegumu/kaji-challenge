import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { ensureLatestPWARegistration, waitForPWARegistration } from "../../../app/pwa-register";
import {
  deletePushSubscription,
  getPushSubscriptionsMe,
  PushPlatform,
  postPushSubscription,
} from "../../../lib/api/operations";
import { queryKeys } from "../../../shared/query/queryKeys";
import { formatError } from "../../../shared/utils/errors";
import {
  isPushSupported,
  isStandalonePWA,
  serializePushSubscription,
  urlBase64ToUint8Array,
} from "../lib/pushClient";

type StatusSetter = (message: string) => void;

async function getCurrentBrowserSubscription() {
  const registration = await waitForPWARegistration();
  if (registration == null) {
    return null;
  }
  return registration.pushManager.getSubscription();
}

export function usePushNotifications(setStatus: StatusSetter) {
  const queryClient = useQueryClient();
  const [deviceEndpoint, setDeviceEndpoint] = useState<string | null>(null);
  const active = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const subscriptionsQuery = useQuery({
    queryKey: queryKeys.pushSubscriptions,
    queryFn: async ({ signal }) => (await getPushSubscriptionsMe({ signal })).data,
    staleTime: 60_000,
    retry: false,
  });

  const upsertMutation = useMutation({
    mutationFn: async (payload: Parameters<typeof postPushSubscription>[0]) =>
      postPushSubscription(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.pushSubscriptions,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (subscriptionId: string) => deletePushSubscription(subscriptionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.pushSubscriptions,
      });
    },
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!isPushSupported() || Notification.permission !== "granted") {
        setDeviceEndpoint(null);
        return;
      }
      try {
        const subscription = await getCurrentBrowserSubscription();
        if (!cancelled) {
          setDeviceEndpoint(subscription?.endpoint ?? null);
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(`プッシュ通知の購読情報の取得に失敗しました: ${formatError(error)}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setStatus]);

  const enableCurrentDevice = async () => {
    if (!active.current) return;
    if (!isPushSupported()) {
      setStatus("この端末では Web Push を利用できません。");
      return;
    }
    if (!isStandalonePWA()) {
      setStatus("iPhone の Safari でホーム画面に追加した PWA から有効化してください。");
      return;
    }
    const vapidPublicKey = subscriptionsQuery.data?.vapidPublicKey.trim() ?? "";
    if (vapidPublicKey === "") {
      setStatus("プッシュ通知設定がまだ有効化されていません。");
      return;
    }

    const permission = await Notification.requestPermission();
    if (!active.current) return;
    if (permission !== "granted") {
      setStatus(
        permission === "denied"
          ? "通知が拒否されたため有効化できませんでした。"
          : "通知許可が完了していません。",
      );
      return;
    }

    const registration = await ensureLatestPWARegistration();
    if (!active.current) return;
    if (registration == null) {
      setStatus("Service Worker の準備がまだ完了していません。");
      return;
    }

    let subscription = await registration.pushManager.getSubscription();
    if (!active.current) return;
    if (subscription == null) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      if (!active.current) return;
    }
    const serialized = serializePushSubscription(subscription);
    if (serialized == null) {
      setStatus("購読情報の取得に失敗しました。");
      return;
    }

    await upsertMutation.mutateAsync({
      ...serialized,
      platform: PushPlatform.ios_safari_pwa,
      userAgent: navigator.userAgent,
    });
    if (!active.current) return;
    setDeviceEndpoint(serialized.endpoint);
    setStatus("この端末のプッシュ通知をオンにしました。");
  };

  const disableCurrentDevice = async () => {
    if (!active.current) return;
    if (!isPushSupported()) {
      setStatus("この端末では Web Push を利用できません。");
      return;
    }
    const subscription = await getCurrentBrowserSubscription();
    if (!active.current) return;
    const endpoint = subscription?.endpoint ?? deviceEndpoint;
    const match = subscriptionsQuery.data?.items.find(
      (item) => item.endpoint === endpoint && item.isActive,
    );
    if (match != null) {
      await deleteMutation.mutateAsync(match.id);
      if (!active.current) return;
    }
    if (subscription != null) {
      await subscription.unsubscribe();
      if (!active.current) return;
    }
    setDeviceEndpoint(null);
    setStatus("この端末のプッシュ通知をオフにしました。");
  };

  const sendLocalTestNotification = async () => {
    if (!active.current) return;
    if (!isPushSupported()) {
      setStatus("この端末では Web Push を利用できません。");
      return;
    }
    if (!isStandalonePWA()) {
      setStatus("iPhone の Safari でホーム画面に追加した PWA から確認してください。");
      return;
    }
    if (Notification.permission !== "granted") {
      setStatus("プッシュ通知の許可がまだ有効ではありません。");
      return;
    }
    const registration = await waitForPWARegistration();
    if (!active.current) return;
    if (registration == null) {
      setStatus("Service Worker の準備がまだ完了していません。");
      return;
    }
    const tag = `kaji-challenge-local-test:${Date.now()}`;
    const notificationOptions: NotificationOptions & {
      renotify?: boolean;
      timestamp?: number;
    } = {
      body: "プッシュ通知テストです。表示できれば OS 側の通知機能は正常です。",
      tag,
      renotify: true,
      data: {
        teamId: "",
        slotKind: "local_test",
        url: "/",
      },
      icon: "/icons/pwa-192x192.png",
      badge: "/icons/pwa-64x64.png",
      timestamp: Date.now(),
    };
    await registration.showNotification("家事チャレンジ", notificationOptions);
    if (!active.current) return;
    setStatus("プッシュ通知テストを送信しました。");
  };

  const activeCount = subscriptionsQuery.data?.items.filter((item) => item.isActive).length ?? 0;
  const isCurrentDeviceEnabled =
    deviceEndpoint != null &&
    (subscriptionsQuery.data?.items.some(
      (item) => item.endpoint === deviceEndpoint && item.isActive,
    ) ??
      false);

  return {
    activeCount,
    isConfigured: (subscriptionsQuery.data?.vapidPublicKey.trim().length ?? 0) > 0,
    isCurrentDeviceEnabled,
    isLoading: subscriptionsQuery.isLoading || upsertMutation.isPending || deleteMutation.isPending,
    isStandalone: isStandalonePWA(),
    isSupported: isPushSupported(),
    subscriptions: subscriptionsQuery.data?.items ?? [],
    enableCurrentDevice: async () => {
      try {
        await enableCurrentDevice();
      } catch (error) {
        if (active.current) setStatus(`プッシュ通知の有効化に失敗しました: ${formatError(error)}`);
      }
    },
    disableCurrentDevice: async () => {
      try {
        await disableCurrentDevice();
      } catch (error) {
        if (active.current) setStatus(`プッシュ通知の解除に失敗しました: ${formatError(error)}`);
      }
    },
    sendLocalTestNotification: async () => {
      try {
        await sendLocalTestNotification();
      } catch (error) {
        if (active.current) setStatus(`プッシュ通知テストに失敗しました: ${formatError(error)}`);
      }
    },
  };
}
