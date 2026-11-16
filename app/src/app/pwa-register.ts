import { clearPWARefresh, notifyPWARefresh } from "./pwa";

const SW_URL = "/sw.js";
const REFRESH_EVENT = "controllerchange";
let registrationScheduled = false;
let swRegistrationPromise: Promise<ServiceWorkerRegistration> | null = null;
const updateChecks = new WeakMap<ServiceWorkerRegistration, Promise<void>>();

const activateWorker = async (
  registration: ServiceWorkerRegistration,
  worker: ServiceWorker,
  options?: { reload?: boolean },
) => {
  await waitForInstallation(worker);
  if (navigator.serviceWorker.controller !== worker) {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        navigator.serviceWorker.removeEventListener(REFRESH_EVENT, onControllerChange);
      };
      const onControllerChange = () => {
        if (navigator.serviceWorker.controller !== worker) return;
        cleanup();
        resolve();
      };
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("Update activation timed out"));
      }, 30_000);
      navigator.serviceWorker.addEventListener(REFRESH_EVENT, onControllerChange);
      try {
        if (registration.waiting === worker) worker.postMessage({ type: "SKIP_WAITING" });
        else if (registration.active !== worker) throw new Error("Update is no longer available");
        onControllerChange();
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

function updateCandidate(registration: ServiceWorkerRegistration) {
  if (!registration.active) return null;
  return (
    [registration.installing, registration.waiting].find(
      (worker) => worker && (worker.state === "installing" || worker.state === "installed"),
    ) ?? null
  );
}

function notifyIfUpdateAvailable(registration: ServiceWorkerRegistration) {
  const worker = updateCandidate(registration);
  if (!worker) return false;
  notifyPWARefresh(() => activateWorker(registration, worker));
  return true;
}

function updateRegistration(registration: ServiceWorkerRegistration) {
  let pending = updateChecks.get(registration);
  if (!pending) {
    pending = registration
      .update()
      .then(() => {})
      .finally(() => updateChecks.delete(registration));
    updateChecks.set(registration, pending);
  }
  return pending;
}

const bindRegistrationListeners = (registration: ServiceWorkerRegistration) => {
  const watchedWorkers = new WeakSet<ServiceWorker>();
  const checkForUpdates = () => {
    void updateRegistration(registration).catch(() => {
      // Offline or transient network failures are expected here.
    });
  };

  const watchInstalling = () => {
    const installing = registration.installing;
    if (!installing || watchedWorkers.has(installing)) return;
    watchedWorkers.add(installing);
    // Update discovery precedes precaching. Announce it without waiting for every asset.
    notifyIfUpdateAvailable(registration);
    const onStateChange = () => {
      if (installing.state === "installing") return;
      installing.removeEventListener("statechange", onStateChange);
      if (installing.state === "redundant" && !notifyIfUpdateAvailable(registration))
        clearPWARefresh();
    };
    installing.addEventListener("statechange", onStateChange);
  };
  registration.addEventListener("updatefound", watchInstalling);
  watchInstalling();
  notifyIfUpdateAvailable(registration);
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
    .register(SW_URL, { updateViaCache: "none" })
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
  if (notifyIfUpdateAvailable(registration)) return "available";
  if (!navigator.onLine) throw new Error("Cannot check for updates offline");
  if (!registration.installing) await updateRegistration(registration);
  return notifyIfUpdateAvailable(registration) ? "available" : "current";
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
    await updateRegistration(registration);
  } catch {
    // Offline or transient network failures are expected here.
  }
  if (registration.waiting) {
    await activateWorker(registration, registration.waiting, { reload: false });
    try {
      return await navigator.serviceWorker.ready;
    } catch {
      return registration;
    }
  }
  return registration;
};
