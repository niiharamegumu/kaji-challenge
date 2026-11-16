import { atom } from "jotai";
import { createContext, useContext } from "react";
import {
  defaultUserPreferences,
  type UserPreferences,
  type UpdateUserPreferences,
} from "../../contracts/user-preferences";

// Only the authenticated provider writes this atom. It is cleared on identity changes.
export const activeUserPreferencesAtom = atom<UserPreferences | null>(null);

type UserPreferencesContextValue = {
  preferences: UserPreferences;
  ready: boolean;
  writable: boolean;
  saving: boolean;
  error: string | null;
  update: (patch: UpdateUserPreferences) => void;
  refresh: () => void;
};
export const UserPreferencesContext = createContext<UserPreferencesContextValue>({
  preferences: defaultUserPreferences,
  ready: false,
  writable: false,
  saving: false,
  error: null,
  update: () => {},
  refresh: () => {},
});
export const useUserPreferences = () => useContext(UserPreferencesContext);
