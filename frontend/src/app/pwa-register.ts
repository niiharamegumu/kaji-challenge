import { notifyPWARefresh } from "./pwa";

const SW_URL = "/sw.js";
const REFRESH_EVENT = "controllerchange";
const UPDATE_CHECK_INTERVAL_MS = 60_000;

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
  let intervalID: number | null = null;

  const notifyIfWaiting = () => {
    if (registration.waiting) {
      notifyPWARefresh(() => applyWaitingWorkerUpdate(registration));
    }
  };

  const checkForUpdates = () => {
    void registration.update();
  };

  const startIntervalCheck = () => {
    if (intervalID != null) {
      return;
    }
    intervalID = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        checkForUpdates();
      }
    }, UPDATE_CHECK_INTERVAL_MS);
  };

  const stopIntervalCheck = () => {
    if (intervalID == null) {
      return;
    }
    window.clearInterval(intervalID);
    intervalID = null;
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
        notifyPWARefresh(() => applyWaitingWorkerUpdate(registration));
      }
    });
  });

  window.addEventListener("focus", checkForUpdates);
  window.addEventListener("pageshow", checkForUpdates);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      startIntervalCheck();
      checkForUpdates();
      return;
    }
    stopIntervalCheck();
  });
  startIntervalCheck();
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
