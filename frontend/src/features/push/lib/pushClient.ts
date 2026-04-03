export type SerializedPushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

type MaybeStandaloneNavigator = Navigator & {
  standalone?: boolean;
};

export function isStandalonePWA() {
  if (typeof window === "undefined") {
    return false;
  }
  const displayModeStandalone =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  const safariStandalone = (navigator as MaybeStandaloneNavigator).standalone;
  return displayModeStandalone || safariStandalone === true;
}

export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const rawData = window.atob(base64);
  return Uint8Array.from(rawData, (char) => char.charCodeAt(0));
}

function encodeKey(value: ArrayBuffer | null) {
  if (value == null) {
    return null;
  }
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary).replaceAll("+", "-").replaceAll("/", "_");
}

export function serializePushSubscription(
  subscription: PushSubscription | null,
): SerializedPushSubscription | null {
  if (subscription == null) {
    return null;
  }
  const p256dh = encodeKey(subscription.getKey("p256dh"));
  const auth = encodeKey(subscription.getKey("auth"));
  if (p256dh == null || auth == null) {
    return null;
  }
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh, auth },
  };
}
