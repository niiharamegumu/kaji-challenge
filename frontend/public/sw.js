self.SW_VERSION = "2026-04-03-remote-push-debug";

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
  if (event.data?.type === "GET_SW_VERSION") {
    event.source?.postMessage({
      type: "SW_VERSION",
      version: self.SW_VERSION,
    });
  }
});

async function readPushPayload(event) {
  let rawText = "";
  if (event.data != null && typeof event.data.text === "function") {
    try {
      rawText = event.data.text();
    } catch {
      rawText = "";
    }
  }

  let payload = {};
  if (rawText !== "") {
    try {
      const parsed = JSON.parse(rawText);
      if (parsed != null && typeof parsed === "object") {
        payload = parsed;
      }
    } catch {
      payload = {};
    }
  }

  return { payload, rawText };
}

async function handlePush(event) {
  const { payload, rawText } = await readPushPayload(event);
  const debugReceivedAt = new Date().toISOString();
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
  const tag = `${tagBase}:${debugReceivedAt}`;
  const url = payload.url ?? "/";

  await self.registration.showNotification(title, {
    body,
    tag,
    renotify: true,
    data: {
      teamId: payload.teamId ?? "",
      slotKind: payload.slotKind ?? "",
      url,
      debugRawText: rawText,
      debugReceivedAt,
      debugVersion: self.SW_VERSION,
    },
    icon: "/icons/pwa-192x192.png",
    badge: "/icons/pwa-64x64.png",
    timestamp: Date.now(),
  });
}

self.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let targetUrl = self.location.origin;
  try {
    targetUrl = new URL(
      event.notification.data?.url ?? "/",
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
