import { useAtomValue } from "jotai";
import { themePreferenceAtom } from "./theme";

/** Keep browser/system changes active on every route, including login and boot. */
export function ThemeSync() {
  useAtomValue(themePreferenceAtom);
  return null;
}
