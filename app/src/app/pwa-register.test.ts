import { afterEach, beforeEach, expect, it, vi } from "vitest";
const register = vi.fn();
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DEV", false);
  register.mockReset().mockResolvedValue({
    waiting: null,
    update: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn(),
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register, controller: null },
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
});
it("registers after hydration when the document load event already fired, only once", async () => {
  Object.defineProperty(document, "readyState", { configurable: true, value: "complete" });
  const { initializePWA, waitForPWARegistration } = await import("./pwa-register");
  initializePWA();
  initializePWA();
  await waitForPWARegistration();
  expect(register).toHaveBeenCalledExactlyOnceWith("/sw.js");
});
it("waits for load during initial document loading", async () => {
  Object.defineProperty(document, "readyState", { configurable: true, value: "loading" });
  const { initializePWA, waitForPWARegistration } = await import("./pwa-register");
  initializePWA();
  expect(register).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("load"));
  await waitForPWARegistration();
  expect(register).toHaveBeenCalledTimes(1);
});
