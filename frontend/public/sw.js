self.SW_VERSION = "2026-04-04-sw-inspector-debug";

self.addEventListener("install", () => {
  console.log("[sw] install", { version: self.SW_VERSION });
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
  void broadcastDebugLog("info", "message", {
    type: event.data?.type ?? null,
  });
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

async function broadcastDebugLog(level, eventName, details) {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of clients) {
    client.postMessage({
      type: "SW_DEBUG_LOG",
      level,
      eventName,
      version: self.SW_VERSION,
      details,
    });
  }
}

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
  console.log("[sw] push event listener invoked", {
    version: self.SW_VERSION,
    hasEventData: event.data != null,
  });
  await broadcastDebugLog("info", "push event listener invoked", {
    hasEventData: event.data != null,
  });

  const { payload, rawText } = await readPushPayload(event);
  const debugReceivedAt = new Date().toISOString();
  console.log("[sw] push received", {
    version: self.SW_VERSION,
    hasEventData: event.data != null,
    debugReceivedAt,
  });
  console.log("[sw] push payload parsed", {
    version: self.SW_VERSION,
    rawTextLength: rawText.length,
    payloadKeys: Object.keys(payload),
  });
  await broadcastDebugLog("info", "push payload parsed", {
    rawTextLength: rawText.length,
    payloadKeys: Object.keys(payload),
  });

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

  console.log("[sw] showNotification start", {
    version: self.SW_VERSION,
    title,
    body,
    tag,
    url,
  });
  await broadcastDebugLog("info", "showNotification start", {
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
        debugRawText: rawText,
        debugReceivedAt,
        debugVersion: self.SW_VERSION,
      },
      icon: "/icons/pwa-192x192.png",
      badge: "/icons/pwa-64x64.png",
      timestamp: Date.now(),
    });
    console.log("[sw] showNotification success", {
      version: self.SW_VERSION,
      tag,
    });
    await broadcastDebugLog("info", "showNotification success", {
      tag,
    });
  } catch (error) {
    console.error("[sw] showNotification failed", {
      version: self.SW_VERSION,
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack ?? null,
            }
          : String(error),
    });
    await broadcastDebugLog("error", "showNotification failed", {
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack ?? null,
            }
          : String(error),
    });
    throw error;
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event));
});

self.addEventListener("notificationclick", (event) => {
  console.log("[sw] notificationclick", {
    version: self.SW_VERSION,
    data: event.notification.data ?? null,
  });
  void broadcastDebugLog("info", "notificationclick", {
    data: event.notification.data ?? null,
  });
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
