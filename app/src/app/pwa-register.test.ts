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

function installingWorker() {
  return Object.assign(new EventTarget(), { state: "installing" });
}

it("waits for the download and offers an update again after dismissal", async () => {
  const installing = installingWorker();
  const registration = Object.assign(new EventTarget(), {
    active: {},
    waiting: null as EventTarget | null,
    installing: null as EventTarget | null,
    update: vi.fn(async () => {}),
  });
  register.mockResolvedValue(registration);
  const { checkForPWAUpdate } = await import("./pwa-register");
  const { dismissPWAUpdate, subscribePWAState } = await import("./pwa");
  const onState = vi.fn();
  const unsubscribe = subscribePWAState(onState);
  expect(await checkForPWAUpdate()).toBe("current");
  registration.update.mockImplementationOnce(async () => {
    registration.installing = installing;
    registration.dispatchEvent(new Event("updatefound"));
  });
  const pending = checkForPWAUpdate();
  await vi.waitFor(() => expect(registration.installing).toBe(installing));
  expect(onState).toHaveBeenLastCalledWith({ needRefresh: false });
  registration.installing = null;
  registration.waiting = installing;
  installing.state = "installed";
  installing.dispatchEvent(new Event("statechange"));
  expect(await pending).toBe("available");
  dismissPWAUpdate();
  registration.update.mockClear();
  expect(await checkForPWAUpdate()).toBe("available");
  expect(registration.update).not.toHaveBeenCalled();
  expect(onState).toHaveBeenLastCalledWith({ needRefresh: true });
  unsubscribe();
});

it("rejects a failed installation instead of reporting the app as current", async () => {
  const installing = installingWorker();
  register.mockResolvedValue(
    Object.assign(new EventTarget(), {
      installing,
      active: {},
      waiting: null,
    }),
  );
  const { checkForPWAUpdate } = await import("./pwa-register");
  const pending = checkForPWAUpdate();
  const failure = expect(pending).rejects.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 0));
  installing.state = "redundant";
  installing.dispatchEvent(new Event("statechange"));
  await failure;
});

it("reports checks as unavailable when service workers are unsupported", async () => {
  Reflect.deleteProperty(navigator, "serviceWorker");
  const { checkForPWAUpdate } = await import("./pwa-register");
  expect(await checkForPWAUpdate()).toBe("unavailable");
});
