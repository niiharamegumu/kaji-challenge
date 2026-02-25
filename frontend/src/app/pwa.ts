type PWAState = {
  needRefresh: boolean;
};

type Listener = (state: PWAState) => void;

const listeners = new Set<Listener>();
let state: PWAState = { needRefresh: false };
let applyUpdate: null | (() => Promise<void>) = null;

const emit = () => {
  for (const listener of listeners) {
    listener(state);
  }
};

export const subscribePWAState = (listener: Listener) => {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
};

export const notifyPWARefresh = (updater: () => Promise<void>) => {
  applyUpdate = updater;
  state = { needRefresh: true };
  emit();
};

export const dismissPWAUpdate = () => {
  state = { needRefresh: false };
  emit();
};

export const applyPWAUpdateNow = async () => {
  const updater = applyUpdate;
  state = { needRefresh: false };
  emit();
  if (updater != null) {
    await updater();
  }
};
