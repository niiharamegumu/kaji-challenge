/// <reference lib="webworker" />

import { ExpirationPlugin } from "workbox-expiration";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { StaleWhileRevalidate } from "workbox-strategies";

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<unknown>;
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api\//],
  }),
);

registerRoute(
  /^https?:\/\/[^/]+\/(?:assets|icons)\/.*\.(?:js|mjs|css|woff2?|ico|png|svg|webp)$/i,
  new StaleWhileRevalidate({
    cacheName: "static-assets-v1",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 128,
        maxAgeSeconds: 60 * 60 * 24 * 7,
      }),
    ],
  }),
  "GET",
);

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function readPushPayload(event: PushEvent) {
  let rawText = "";
  if (event.data != null && typeof event.data.text === "function") {
    try {
      rawText = event.data.text();
    } catch {
      rawText = "";
    }
  }

  let payload: Record<string, unknown> = {};
  if (rawText !== "") {
    try {
      const parsed = JSON.parse(rawText);
      if (parsed != null && typeof parsed === "object") {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = {};
    }
  }

  return { payload, rawText };
}

async function handlePush(event: PushEvent) {
  const { payload, rawText } = await readPushPayload(event);

  const title =
    typeof payload.title === "string" && payload.title.trim() !== ""
      ? payload.title
      : "家事チャレンジ (remote push)";
  const body =
    typeof payload.body === "string" && payload.body.trim() !== ""
      ? payload.body
      : rawText.trim() !== ""
        ? `Remote push payload: ${rawText.slice(0, 120)}`
        : "Remote push を受信しました。";
  const tagBase =
    typeof payload.tag === "string" && payload.tag.trim() !== ""
      ? payload.tag
      : "kaji-challenge-remote";
  const tag = tagBase;
  const url =
    typeof payload.url === "string" && payload.url.trim() !== ""
      ? payload.url
      : "/";

  const notificationOptions: NotificationOptions & {
    renotify?: boolean;
    timestamp?: number;
  } = {
    body,
    tag,
    renotify: true,
    data: {
      teamId: typeof payload.teamId === "string" ? payload.teamId : "",
      slotKind: typeof payload.slotKind === "string" ? payload.slotKind : "",
      url,
    },
    icon: "/icons/pwa-192x192.png",
    badge: "/icons/pwa-64x64.png",
    timestamp: Date.now(),
  };
  await self.registration.showNotification(title, notificationOptions);
}

self.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let targetUrl = self.location.origin;
  try {
    targetUrl = new URL(
      typeof event.notification.data?.url === "string"
        ? event.notification.data.url
        : "/",
      self.location.origin,
    ).toString();
  } catch {
    targetUrl = self.location.origin;
  }

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      }),
  );
});
