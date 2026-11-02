import { atom } from "jotai";

export type ThemePreference = "system" | "dark" | "light";
export const THEME_STORAGE_KEY = "kaji:theme:v1";
const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

function normalizePreference(value: unknown): ThemePreference {
  return value === "dark" || value === "light" ? value : "system";
}

function readPreference(): ThemePreference {
  try {
    return normalizePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function applyTheme(preference: ThemePreference) {
  document.documentElement.dataset.theme = preference;
  const dark =
    preference === "dark" ||
    (preference === "system" && window.matchMedia?.(DARK_MEDIA_QUERY).matches);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#191b19" : "#f6f4ef");
}

// Runs in <head> before the stylesheet/body, including the cached PWA shell.
// Only fixed source and a fixed storage key enter this script; no user input is interpolated.
export const THEME_BOOTSTRAP_SCRIPT = `(()=>{
  let theme="system";
  try { const value=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    if(value==="dark"||value==="light") theme=value;
  } catch {}
  document.documentElement.dataset.theme=theme;
  const dark=theme==="dark"||(theme==="system"&&window.matchMedia?.("${DARK_MEDIA_QUERY}").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content",dark?"#191b19":"#f6f4ef");
})();`;

const preferenceAtom = atom<ThemePreference>("system");
preferenceAtom.onMount = (setValue) => {
  const synchronize = () => {
    const preference = readPreference();
    applyTheme(preference);
    setValue(preference);
  };
  synchronize();
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    try {
      if (event.storageArea === window.localStorage) synchronize();
    } catch {
      // Keep the current selection if browser storage becomes unavailable.
    }
  };
  const media = window.matchMedia?.(DARK_MEDIA_QUERY);
  const onSystemChange = () => {
    // Also retain an explicit selection that could not be persisted.
    applyTheme(normalizePreference(document.documentElement.dataset.theme));
  };
  window.addEventListener("storage", onStorage);
  media?.addEventListener("change", onSystemChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    media?.removeEventListener("change", onSystemChange);
  };
};

export const themePreferenceAtom = atom(
  (get) => get(preferenceAtom),
  (_get, set, value: ThemePreference) => {
    const preference = normalizePreference(value);
    set(preferenceAtom, preference);
    applyTheme(preference);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
      return true;
    } catch {
      return false;
    }
  },
);
