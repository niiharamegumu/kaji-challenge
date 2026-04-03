import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isStandalonePWA,
  serializePushSubscription,
  urlBase64ToUint8Array,
} from "./pushClient";

describe("pushClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects standalone display mode", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));

    expect(isStandalonePWA()).toBe(true);
  });

  it("serializes push subscription keys", () => {
    const encoder = new TextEncoder();
    const subscription = {
      endpoint: "https://example.com/push",
      getKey: vi.fn((name: string) => {
        if (name === "p256dh") {
          return encoder.encode("hello").buffer;
        }
        if (name === "auth") {
          return encoder.encode("world").buffer;
        }
        return null;
      }),
    } as unknown as PushSubscription;

    expect(serializePushSubscription(subscription)).toEqual({
      endpoint: "https://example.com/push",
      keys: {
        p256dh: "aGVsbG8=",
        auth: "d29ybGQ=",
      },
    });
  });

  it("decodes base64url VAPID keys", () => {
    const bytes = urlBase64ToUint8Array("SGVsbG8");
    expect(Array.from(bytes)).toEqual([72, 101, 108, 108, 111]);
  });
});
