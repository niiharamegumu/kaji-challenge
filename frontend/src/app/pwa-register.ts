import { notifyPWARefresh } from "./pwa";

const SW_URL = "/sw.js";
const REFRESH_EVENT = "controllerchange";

const applyWaitingWorkerUpdate = async (
  registration: ServiceWorkerRegistration,
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

  window.location.reload();
};

const bindRegistrationListeners = (registration: ServiceWorkerRegistration) => {
  const notifyIfWaiting = () => {
    if (registration.waiting) {
      notifyPWARefresh(() => applyWaitingWorkerUpdate(registration));
    }
  };

  notifyIfWaiting();

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
        notifyPWARefresh(() => applyWaitingWorkerUpdate(registration));
      }
    });
  });

  const checkForUpdates = () => {
    void registration.update();
  };

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
    void (async () => {
      const registration = await navigator.serviceWorker.register(SW_URL);
      bindRegistrationListeners(registration);
    })();
  });
};
