type PWAState = {
  needRefresh: boolean;
  applying: boolean;
};

type Listener = (state: PWAState) => void;

const listeners = new Set<Listener>();
let state: PWAState = { needRefresh: false, applying: false };
let applyUpdate: null | (() => Promise<void>) = null;
let updateInFlight: Promise<void> | null = null;

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
  if (state.needRefresh || state.applying) return;
  state = { needRefresh: true, applying: false };
  emit();
};

export const dismissPWAUpdate = () => {
  state = { ...state, needRefresh: false };
  emit();
};

export const clearPWARefresh = () => {
  applyUpdate = null;
  dismissPWAUpdate();
};

export const applyPWAUpdateNow = () => {
  if (updateInFlight) return updateInFlight;
  const updater = applyUpdate;
  if (!updater) return Promise.resolve();
  updateInFlight = Promise.resolve()
    .then(updater)
    .finally(() => {
      if (applyUpdate === updater) applyUpdate = null;
      updateInFlight = null;
      state = { needRefresh: applyUpdate !== null, applying: false };
      emit();
    });
  state = { needRefresh: false, applying: true };
  emit();
  return updateInFlight;
};
