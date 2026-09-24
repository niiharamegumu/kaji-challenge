import { afterEach, describe, expect, it, vi } from "vitest";
import { authSettings } from "../../src/server/transport/auth-settings";

const bindings = {
  APP_ORIGIN: "http://localhost:5174",
  BETTER_AUTH_SECRET: "test-only-secret-at-least-32-characters",
  GOOGLE_CLIENT_ID: "test-client",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  SIGNUP_ALLOWED_EMAILS: "allowed@example.com",
};
afterEach(() => vi.restoreAllMocks());
describe("authentication runtime configuration", () => {
  it.each(Object.keys(bindings))("returns a safe 503 when %s is missing", (key) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => authSettings({ ...bindings, [key]: undefined })).toThrowError(
      expect.objectContaining({ status: 503, code: "configuration_unavailable" }),
    );
    const output = JSON.stringify(log.mock.calls);
    expect(output).not.toContain(bindings.BETTER_AUTH_SECRET);
    expect(output).not.toContain(bindings.GOOGLE_CLIENT_SECRET);
    expect(output).not.toContain(bindings.SIGNUP_ALLOWED_EMAILS);
  });
  it.each(["", " , "])("fails closed for an empty allowlist (%s)", (SIGNUP_ALLOWED_EMAILS) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => authSettings({ ...bindings, SIGNUP_ALLOWED_EMAILS })).toThrowError(
      expect.objectContaining({ status: 503 }),
    );
  });
  it.each([
    "not-a-url",
    "https://example.com/path",
    "https://secret@example.com",
    "https://example.com?secret=value",
    "http://example.com",
  ])("rejects an invalid application origin", (APP_ORIGIN) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => authSettings({ ...bindings, APP_ORIGIN })).toThrowError(
      expect.objectContaining({ status: 503 }),
    );
  });
  it("keeps the allowlist and accepts a configured origin with a trailing slash", () => {
    expect(authSettings({ ...bindings, APP_ORIGIN: "https://app.example.com/" })).toMatchObject({
      allowedEmails: ["allowed@example.com"],
    });
  });
  it("rejects a short session secret without logging its value", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "short-private-secret";
    expect(() => authSettings({ ...bindings, BETTER_AUTH_SECRET: secret })).toThrowError(
      expect.objectContaining({ status: 503 }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  });
  it("cannot disable registration restrictions with a legacy environment flag", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const legacy = { ...bindings, SIGNUP_GUARD_ENABLED: "false", SIGNUP_ALLOWED_EMAILS: "" };
    expect(() => authSettings(legacy)).toThrowError(expect.objectContaining({ status: 503 }));
  });
});
