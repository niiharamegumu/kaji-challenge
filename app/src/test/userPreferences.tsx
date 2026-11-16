import type { ComponentProps, ReactNode } from "react";
import { defaultUserPreferences } from "../contracts/user-preferences";
import { UserPreferencesContext } from "../shared/state/userPreferences";

export function PreferencesFixture({
  children,
  ...overrides
}: {
  children: ReactNode;
} & Partial<ComponentProps<typeof UserPreferencesContext>["value"]>) {
  return (
    <UserPreferencesContext
      value={{
        preferences: defaultUserPreferences,
        ready: true,
        writable: true,
        saving: false,
        error: null,
        update: () => {},
        refresh: () => {},
        ...overrides,
      }}
    >
      {children}
    </UserPreferencesContext>
  );
}
