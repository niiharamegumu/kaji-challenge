import { notifyPWARefresh } from "./pwa";

export const initializePWA = () => {
  if (import.meta.env.DEV) {
    return;
  }

  if (!("serviceWorker" in navigator)) {
    return;
  }

  void (async () => {
    const modulePath = "virtual:pwa-register";
    const { registerSW } = await import(/* @vite-ignore */ modulePath);

    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        notifyPWARefresh(() => updateSW(true));
      },
    });
  })();
};
