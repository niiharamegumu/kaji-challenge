import { afterEach, beforeEach, expect, it, vi } from "vitest";

const register = vi.fn();
const reload = vi.fn();
function worker(state: ServiceWorkerState = "installing") {
  return Object.assign(new EventTarget(), { state, postMessage: vi.fn() });
}
function registration() {
  return Object.assign(new EventTarget(), {
    active: worker("activated") as ReturnType<typeof worker> | null,
    waiting: null as ReturnType<typeof worker> | null,
    installing: null as ReturnType<typeof worker> | null,
    update: vi.fn(async () => {}),
  });
}
let container: EventTarget & {
  register: typeof register;
  controller: ReturnType<typeof worker> | null;
};
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv("DEV", false);
  reload.mockReset();
  register.mockReset().mockResolvedValue(registration());
  container = Object.assign(new EventTarget(), { register, controller: null });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  Object.defineProperty(document, "readyState", { configurable: true, value: "complete" });
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      setTimeout: window.setTimeout.bind(window),
      location: { reload },
    }),
  );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("registers only once after hydration and bypasses the script HTTP cache", async () => {
  const { initializePWA, waitForPWARegistration } = await import("./pwa-register");
  initializePWA();
  initializePWA();
  await waitForPWARegistration();
  expect(register).toHaveBeenCalledExactlyOnceWith("/sw.js", { updateViaCache: "none" });
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

it("announces discovery before precaching completes and reoffers it immediately on manual checks", async () => {
  const reg = registration();
  const installing = worker();
  register.mockResolvedValue(reg);
  const { checkForPWAUpdate } = await import("./pwa-register");
  const { dismissPWAUpdate, subscribePWAState } = await import("./pwa");
  const onState = vi.fn();
  subscribePWAState(onState);
  expect(await checkForPWAUpdate()).toBe("current");
  reg.update.mockImplementationOnce(async () => {
    reg.installing = installing;
    reg.dispatchEvent(new Event("updatefound"));
  });
  expect(await checkForPWAUpdate()).toBe("available");
  expect(installing.state).toBe("installing");
  expect(onState).toHaveBeenLastCalledWith({ needRefresh: true, applying: false });
  dismissPWAUpdate();
  reg.dispatchEvent(new Event("updatefound"));
  expect(onState).toHaveBeenLastCalledWith({ needRefresh: false, applying: false });
  reg.update.mockClear();
  expect(await checkForPWAUpdate()).toBe("available");
  expect(reg.update).not.toHaveBeenCalled();
  dismissPWAUpdate();
  reg.installing = null;
  reg.waiting = installing;
  installing.state = "installed";
  installing.dispatchEvent(new Event("statechange"));
  expect(onState).toHaveBeenLastCalledWith({ needRefresh: false, applying: false });
  expect(await checkForPWAUpdate()).toBe("available");
});

it.each([false, true])(
  "waits for the newest installation and its controller change before reloading once (older waiting update: %s)",
  async (olderWaiting) => {
    const reg = registration();
    const installing = worker();
    const older = worker("installed");
    if (olderWaiting) reg.waiting = older;
    reg.installing = installing;
    register.mockResolvedValue(reg);
    const { checkForPWAUpdate } = await import("./pwa-register");
    const { applyPWAUpdateNow, subscribePWAState } = await import("./pwa");
    const onState = vi.fn();
    subscribePWAState(onState);
    expect(await checkForPWAUpdate()).toBe("available");
    const pending = applyPWAUpdateNow();
    expect(applyPWAUpdateNow()).toBe(pending);
    await Promise.resolve();
    expect(onState).toHaveBeenLastCalledWith({ needRefresh: false, applying: true });
    expect(installing.postMessage).not.toHaveBeenCalled();
    expect(older.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    reg.waiting = installing;
    reg.installing = null;
    installing.state = "installed";
    installing.dispatchEvent(new Event("statechange"));
    await vi.waitFor(() =>
      expect(installing.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "SKIP_WAITING" }),
    );
    container.controller = reg.active;
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).not.toHaveBeenCalled();
    reg.active = installing;
    reg.waiting = null;
    container.controller = installing;
    container.dispatchEvent(new Event("controllerchange"));
    await pending;
    expect(reload).toHaveBeenCalledTimes(1);
    expect(onState).toHaveBeenLastCalledWith({ needRefresh: false, applying: false });
  },
);

it("removes a failed installation's prompt and rejects an in-progress application without reloading", async () => {
  const reg = registration();
  const installing = worker();
  reg.installing = installing;
  register.mockResolvedValue(reg);
  const { checkForPWAUpdate } = await import("./pwa-register");
  const { applyPWAUpdateNow, subscribePWAState } = await import("./pwa");
  const onState = vi.fn();
  subscribePWAState(onState);
  expect(await checkForPWAUpdate()).toBe("available");
  const failure = expect(applyPWAUpdateNow()).rejects.toThrow("installation failed");
  await Promise.resolve();
  reg.installing = null;
  installing.state = "redundant";
  installing.dispatchEvent(new Event("statechange"));
  await failure;
  expect(onState).toHaveBeenLastCalledWith({ needRefresh: false, applying: false });
  expect(reload).not.toHaveBeenCalled();
  expect(installing.postMessage).not.toHaveBeenCalled();
  expect(await checkForPWAUpdate()).toBe("current");
});

it("does not announce the initial installation as an update", async () => {
  const reg = registration();
  reg.active = null;
  reg.installing = worker();
  register.mockResolvedValue(reg);
  const { checkForPWAUpdate } = await import("./pwa-register");
  const { subscribePWAState } = await import("./pwa");
  const onState = vi.fn();
  subscribePWAState(onState);
  expect(await checkForPWAUpdate()).toBe("current");
  expect(onState).toHaveBeenCalledExactlyOnceWith({ needRefresh: false, applying: false });
  expect(reg.update).not.toHaveBeenCalled();
});

it("coalesces registration-time, focus and manual checks into one pending network update", async () => {
  const reg = registration();
  let finish!: () => void;
  reg.update.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  register.mockResolvedValue(reg);
  const { initializePWA, waitForPWARegistration, checkForPWAUpdate } =
    await import("./pwa-register");
  initializePWA();
  await waitForPWARegistration();
  window.dispatchEvent(new Event("focus"));
  const first = checkForPWAUpdate();
  const second = checkForPWAUpdate();
  await Promise.resolve();
  expect(reg.update).toHaveBeenCalledTimes(1);
  finish();
  expect(await first).toBe("current");
  expect(await second).toBe("current");
});

it("reports offline errors and allows another check after reconnection", async () => {
  const reg = registration();
  register.mockResolvedValue(reg);
  const { checkForPWAUpdate } = await import("./pwa-register");
  expect(await checkForPWAUpdate()).toBe("current");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  reg.update.mockClear();
  await expect(checkForPWAUpdate()).rejects.toThrow("offline");
  expect(reg.update).not.toHaveBeenCalled();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  expect(await checkForPWAUpdate()).toBe("current");
  expect(reg.update).toHaveBeenCalledTimes(1);
});

it.each(["installation", "activation"])("times out stalled %s without reloading", async (phase) => {
  const reg = registration();
  const update = worker(phase === "installation" ? "installing" : "installed");
  if (phase === "installation") reg.installing = update;
  else reg.waiting = update;
  register.mockResolvedValue(reg);
  const { checkForPWAUpdate } = await import("./pwa-register");
  const { applyPWAUpdateNow } = await import("./pwa");
  expect(await checkForPWAUpdate()).toBe("available");
  const failure = expect(applyPWAUpdateNow()).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(phase === "installation" ? 60_000 : 30_000);
  await failure;
  expect(reload).not.toHaveBeenCalled();
});

it("reports checks as unavailable when service workers are unsupported", async () => {
  Reflect.deleteProperty(navigator, "serviceWorker");
  const { checkForPWAUpdate } = await import("./pwa-register");
  expect(await checkForPWAUpdate()).toBe("unavailable");
});
