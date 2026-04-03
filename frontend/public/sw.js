self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data != null) {
    try {
      payload = event.data.json();
    } catch {
      try {
        payload = JSON.parse(event.data.text());
      } catch {
        payload = {};
      }
    }
  }
  const title = payload.title ?? "家事チャレンジ";
  const body = payload.body ?? "";
  const tag = payload.tag ?? "kaji-challenge";
  const url = payload.url ?? "/";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data: {
        teamId: payload.teamId ?? "",
        slotKind: payload.slotKind ?? "",
        url,
      },
      icon: "/icons/pwa-192x192.png",
      badge: "/icons/pwa-64x64.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(
    event.notification.data?.url ?? "/",
    self.location.origin,
  ).toString();

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
