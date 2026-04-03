import { notifyPWARefresh } from "./pwa";

const SW_URL = "/sw.js";
const REFRESH_EVENT = "controllerchange";
let swRegistrationPromise: Promise<ServiceWorkerRegistration> | null = null;

const activateWaitingWorker = async (
  registration: ServiceWorkerRegistration,
  options?: { reload?: boolean },
) => {
  const waiting = registration.waiting;
  if (!waiting) {
    return;
  }

  await new Promise<void>((resolve) => {
    const onControllerChange = () => {
      navigator.serviceWorker.removeEventListener(
        REFRESH_EVENT,
        onControllerChange,
      );
      resolve();
    };

    navigator.serviceWorker.addEventListener(REFRESH_EVENT, onControllerChange);
    waiting.postMessage({ type: "SKIP_WAITING" });
  });

  if (options?.reload ?? true) {
    window.location.reload();
  }
};

const bindRegistrationListeners = (registration: ServiceWorkerRegistration) => {
  const notifyIfWaiting = () => {
    if (registration.waiting) {
      notifyPWARefresh(() =>
        activateWaitingWorker(registration, { reload: true }),
      );
    }
  };

  const checkForUpdates = () => {
    void registration.update().catch(() => {
      // Offline or transient network failures are expected here.
    });
  };

  notifyIfWaiting();
  checkForUpdates();

  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    if (!installing) {
      return;
    }

    installing.addEventListener("statechange", () => {
      if (
        installing.state === "installed" &&
        navigator.serviceWorker.controller != null
      ) {
        notifyPWARefresh(() =>
          activateWaitingWorker(registration, { reload: true }),
        );
      }
    });
  });

  window.addEventListener("focus", checkForUpdates);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkForUpdates();
    }
  });
};

export const initializePWA = () => {
  if (import.meta.env.DEV) {
    return;
  }

  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    swRegistrationPromise = (async () => {
      const registration = await navigator.serviceWorker.register(SW_URL);
      bindRegistrationListeners(registration);
      return registration;
    })();
    void swRegistrationPromise;
  });
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
