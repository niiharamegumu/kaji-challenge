import { describe, expect, it } from "vitest";

import { resolveSameOriginURL } from "./navigation";

describe("resolveSameOriginURL", () => {
  const origin = "https://app.example";

  it("resolves a relative notification target on the app origin", () => {
    expect(resolveSameOriginURL("/reminders?date=2026-08-10", origin)).toBe(
      "https://app.example/reminders?date=2026-08-10",
    );
  });

  it.each([
    "https://evil.example/phishing",
    "//evil.example",
    "javascript:alert(1)",
  ])("falls back to home for an unsafe target: %s", (target) => {
    expect(resolveSameOriginURL(target, origin)).toBe("https://app.example/");
  });

  it("falls back to home for a malformed target", () => {
    expect(resolveSameOriginURL("https://[invalid", origin)).toBe(
      "https://app.example/",
    );
  });
});
