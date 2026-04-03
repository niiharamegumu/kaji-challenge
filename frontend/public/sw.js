self.SW_VERSION = "2026-04-03-sw-inspector-debug";

self.addEventListener("install", () => {
  console.log("[sw] install", { version: self.SW_VERSION });
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("[sw] activate", { version: self.SW_VERSION });
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  console.log("[sw] message", {
    version: self.SW_VERSION,
    type: event.data?.type ?? null,
  });
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function handlePush(event) {
  console.log("[sw] push received", {
    version: self.SW_VERSION,
    hasEventData: event.data != null,
  });

  let payload = {};
  let rawText = "";
  if (event.data != null) {
    try {
      rawText = event.data.text();
      payload = rawText === "" ? {} : JSON.parse(rawText);
    } catch {
      try {
        payload = event.data.json();
      } catch {
        payload = {};
      }
    }
  }

  console.log("[sw] push payload parsed", {
    version: self.SW_VERSION,
    rawTextLength: rawText.length,
    payloadKeys: Object.keys(payload),
  });

  const title = payload.title ?? "家事チャレンジ (remote push)";
  const body =
    payload.body ??
    (rawText === "" ? "Remote push を受信しました。" : rawText.slice(0, 140));
  const tag = `${payload.tag ?? "kaji-challenge"}:${Date.now()}`;
  const url = payload.url ?? "/";

  console.log("[sw] showNotification start", {
    version: self.SW_VERSION,
    title,
    body,
    tag,
    url,
  });

  try {
    await self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      data: {
        teamId: payload.teamId ?? "",
        slotKind: payload.slotKind ?? "",
        url,
        debugVersion: self.SW_VERSION,
        debugRawText: rawText,
      },
      icon: "/icons/pwa-192x192.png",
      badge: "/icons/pwa-64x64.png",
      timestamp: Date.now(),
    });
    console.log("[sw] showNotification success", {
      version: self.SW_VERSION,
      tag,
    });
  } catch (error) {
    console.error("[sw] showNotification failed", {
      version: self.SW_VERSION,
      tag,
      error,
    });
    throw error;
  }
}

self.addEventListener("push", (event) => {
  console.log("[sw] push event listener invoked", {
    version: self.SW_VERSION,
    hasEventData: event.data != null,
  });
  event.waitUntil(handlePush(event));
});

self.addEventListener("notificationclick", (event) => {
  console.log("[sw] notificationclick", {
    version: self.SW_VERSION,
    data: event.notification.data ?? null,
  });
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
