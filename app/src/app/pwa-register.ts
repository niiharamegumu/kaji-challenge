import { notifyPWARefresh } from "./pwa";

const SW_URL = "/sw.js";
const REFRESH_EVENT = "controllerchange";
let registrationScheduled = false;
let swRegistrationPromise: Promise<ServiceWorkerRegistration> | null = null;

const activateWaitingWorker = async (
  registration: ServiceWorkerRegistration,
  options?: { reload?: boolean },
) => {
  const waiting = registration.waiting;
  if (waiting) {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        navigator.serviceWorker.removeEventListener(REFRESH_EVENT, onControllerChange);
      };
      const onControllerChange = () => {
        if (navigator.serviceWorker.controller !== waiting) return;
        cleanup();
        resolve();
      };
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("Update activation timed out"));
      }, 30_000);
      navigator.serviceWorker.addEventListener(REFRESH_EVENT, onControllerChange);
      try {
        waiting.postMessage({ type: "SKIP_WAITING" });
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  if (options?.reload ?? true) {
    window.location.reload();
  }
};

function notifyIfWaiting(registration: ServiceWorkerRegistration) {
  if (!registration.waiting || !registration.active) return false;
  notifyPWARefresh(() => activateWaitingWorker(registration));
  return true;
}

const bindRegistrationListeners = (registration: ServiceWorkerRegistration) => {
  const checkForUpdates = () => {
    void registration.update().catch(() => {
      // Offline or transient network failures are expected here.
    });
  };

  const watchInstalling = () => {
    const installing = registration.installing;
    if (!installing) return;
    const onStateChange = () => {
      if (installing.state === "installing") return;
      installing.removeEventListener("statechange", onStateChange);
      notifyIfWaiting(registration);
    };
    installing.addEventListener("statechange", onStateChange);
  };
  registration.addEventListener("updatefound", watchInstalling);
  watchInstalling();
  notifyIfWaiting(registration);
  if (!registration.installing && !registration.waiting) checkForUpdates();

  window.addEventListener("focus", checkForUpdates);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkForUpdates();
    }
  });
};

function registerOnce() {
  swRegistrationPromise ??= navigator.serviceWorker
    .register(SW_URL)
    .then((registration) => {
      bindRegistrationListeners(registration);
      return registration;
    })
    .catch((error: unknown) => {
      registrationScheduled = false;
      swRegistrationPromise = null;
      throw error;
    });
  return swRegistrationPromise;
}

function waitForInstallation(worker: ServiceWorker) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      worker.removeEventListener("statechange", check);
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      if (worker.state === "redundant") finish(new Error("Update installation failed"));
      else if (worker.state !== "installing") finish();
    };
    const timer = window.setTimeout(
      () => finish(new Error("Update installation timed out")),
      60_000,
    );
    worker.addEventListener("statechange", check);
    check();
  });
}

export async function checkForPWAUpdate(): Promise<"unavailable" | "available" | "current"> {
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) return "unavailable";
  const registration = await registerOnce();
  if (notifyIfWaiting(registration)) return "available";
  if (!navigator.onLine) throw new Error("Cannot check for updates offline");
  if (!registration.installing) await registration.update();
  const installing = registration.installing;
  if (installing) await waitForInstallation(installing);
  return notifyIfWaiting(registration) ? "available" : "current";
}

export const initializePWA = () => {
  if (import.meta.env.DEV) {
    return;
  }

  if (!("serviceWorker" in navigator)) {
    return;
  }

  if (registrationScheduled) return;
  registrationScheduled = true;
  const register = () => {
    void registerOnce().catch(() => {
      // A manual check can retry registration and report the error to the user.
    });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
};

export const waitForPWARegistration = async () => {
  if (!("serviceWorker" in navigator)) {
    return null;
  }
  if (swRegistrationPromise != null) {
    return swRegistrationPromise;
  }
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
};

export const ensureLatestPWARegistration = async () => {
  const registration = await waitForPWARegistration();
  if (registration == null) {
    return null;
  }
  try {
    await registration.update();
  } catch {
    // Offline or transient network failures are expected here.
  }
  if (registration.waiting) {
    await activateWaitingWorker(registration, { reload: false });
    try {
      return await navigator.serviceWorker.ready;
    } catch {
      return registration;
    }
  }
  return registration;
};
