import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { waitForPWARegistration } from "../../../app/pwa-register";
import {
  PushPlatform,
  deletePushSubscription,
  getPushSubscriptionsMe,
  postPushSubscription,
} from "../../../lib/api/generated/client";
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

async function getPWARegistration() {
  return waitForPWARegistration();
}

export function usePushNotifications(setStatus: StatusSetter) {
  const queryClient = useQueryClient();
  const [deviceEndpoint, setDeviceEndpoint] = useState<string | null>(null);

  const subscriptionsQuery = useQuery({
    queryKey: queryKeys.pushSubscriptions,
    queryFn: async () => (await getPushSubscriptionsMe()).data,
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
    mutationFn: async (subscriptionId: string) =>
      deletePushSubscription(subscriptionId),
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
      const subscription = await getCurrentBrowserSubscription();
      if (!cancelled) {
        setDeviceEndpoint(subscription?.endpoint ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (
        !isPushSupported() ||
        !isStandalonePWA() ||
        Notification.permission !== "granted" ||
        subscriptionsQuery.data == null
      ) {
        return;
      }
      const subscription = await getCurrentBrowserSubscription();
      if (cancelled) {
        return;
      }
      const serialized = serializePushSubscription(subscription);
      setDeviceEndpoint(serialized?.endpoint ?? null);
      if (serialized == null) {
        return;
      }
      const alreadyRegistered = subscriptionsQuery.data.items.some(
        (item) => item.endpoint === serialized.endpoint && item.isActive,
      );
      if (alreadyRegistered) {
        return;
      }
      await upsertMutation.mutateAsync({
        ...serialized,
        platform: PushPlatform.ios_safari_pwa,
        userAgent: navigator.userAgent,
      });
    })().catch(() => {
      // Skip noisy toasts during passive sync.
    });
    return () => {
      cancelled = true;
    };
  }, [subscriptionsQuery.data, upsertMutation]);

  const enableCurrentDevice = useCallback(async () => {
    if (!isPushSupported()) {
      setStatus("この端末では Web Push を利用できません。");
      return;
    }
    if (!isStandalonePWA()) {
      setStatus(
        "iPhone の Safari でホーム画面に追加した PWA から有効化してください。",
      );
      return;
    }
    const vapidPublicKey = subscriptionsQuery.data?.vapidPublicKey.trim() ?? "";
    if (vapidPublicKey === "") {
      setStatus("通知設定がまだ有効化されていません。");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus(
        permission === "denied"
          ? "通知が拒否されたため有効化できませんでした。"
          : "通知許可が完了していません。",
      );
      return;
    }

    const registration = await waitForPWARegistration();
    if (registration == null) {
      setStatus("Service Worker の準備がまだ完了していません。");
      return;
    }

    let subscription = await registration.pushManager.getSubscription();
    if (subscription == null) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
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
    setDeviceEndpoint(serialized.endpoint);
    setStatus("この端末の通知をオンにしました。");
  }, [setStatus, subscriptionsQuery.data, upsertMutation]);

  const disableCurrentDevice = useCallback(async () => {
    if (!isPushSupported()) {
      setStatus("この端末では Web Push を利用できません。");
      return;
    }
    const subscription = await getCurrentBrowserSubscription();
    const endpoint = subscription?.endpoint ?? deviceEndpoint;
    const match = subscriptionsQuery.data?.items.find(
      (item) => item.endpoint === endpoint && item.isActive,
    );
    if (match != null) {
      await deleteMutation.mutateAsync(match.id);
    }
    if (subscription != null) {
      await subscription.unsubscribe();
    }
    setDeviceEndpoint(null);
    setStatus("この端末の通知をオフにしました。");
  }, [
    deleteMutation,
    deviceEndpoint,
    setStatus,
    subscriptionsQuery.data?.items,
  ]);

  const sendLocalTestNotification = useCallback(async () => {
    if (!isPushSupported()) {
      setStatus("この端末では Web Push を利用できません。");
      return;
    }
    if (!isStandalonePWA()) {
      setStatus(
        "iPhone の Safari でホーム画面に追加した PWA から確認してください。",
      );
      return;
    }
    if (Notification.permission !== "granted") {
      setStatus("通知許可がまだ有効ではありません。");
      return;
    }
    const registration = await getPWARegistration();
    if (registration == null) {
      setStatus("Service Worker の準備がまだ完了していません。");
      return;
    }
    await registration.showNotification("家事チャレンジ", {
      body: "ローカル通知テストです。表示できれば OS 側の通知機能は正常です。",
      tag: "kaji-challenge-local-test",
      data: {
        teamId: "",
        slotKind: "local_test",
        url: "/",
      },
      icon: "/icons/pwa-192x192.png",
      badge: "/icons/pwa-64x64.png",
    });
    setStatus("ローカル通知テストを送信しました。");
  }, [setStatus]);

  const activeCount = useMemo(
    () =>
      subscriptionsQuery.data?.items.filter((item) => item.isActive).length ??
      0,
    [subscriptionsQuery.data?.items],
  );
  const isCurrentDeviceEnabled = useMemo(() => {
    if (deviceEndpoint == null) {
      return false;
    }
    return (
      subscriptionsQuery.data?.items.some(
        (item) => item.endpoint === deviceEndpoint && item.isActive,
      ) ?? false
    );
  }, [deviceEndpoint, subscriptionsQuery.data?.items]);

  return {
    activeCount,
    isConfigured:
      (subscriptionsQuery.data?.vapidPublicKey.trim().length ?? 0) > 0,
    isCurrentDeviceEnabled,
    isLoading:
      subscriptionsQuery.isLoading ||
      upsertMutation.isPending ||
      deleteMutation.isPending,
    isStandalone: isStandalonePWA(),
    isSupported: isPushSupported(),
    subscriptions: subscriptionsQuery.data?.items ?? [],
    enableCurrentDevice: async () => {
      try {
        await enableCurrentDevice();
      } catch (error) {
        setStatus(`通知有効化に失敗しました: ${formatError(error)}`);
      }
    },
    disableCurrentDevice: async () => {
      try {
        await disableCurrentDevice();
      } catch (error) {
        setStatus(`通知解除に失敗しました: ${formatError(error)}`);
      }
    },
    sendLocalTestNotification: async () => {
      try {
        await sendLocalTestNotification();
      } catch (error) {
        setStatus(`ローカル通知テストに失敗しました: ${formatError(error)}`);
      }
    },
  };
}
