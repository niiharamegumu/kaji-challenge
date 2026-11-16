import {
  defaultUserPreferences,
  TodoCategorySelectionSchema,
  UserPreferencesSchema,
  type UserPreferences,
} from "../../contracts/user-preferences";

export const userPreferencesStorageKey = (userId: string) => `kaji:user-preferences:v1:${userId}`;
const legacyOwnerKey = "kaji:legacy-preferences-owner:v1";

export function readUserPreferencesCache(userId: string): UserPreferences | null {
  try {
    const result = UserPreferencesSchema.safeParse(
      JSON.parse(localStorage.getItem(userPreferencesStorageKey(userId)) ?? "null"),
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function writeUserPreferencesCache(userId: string, preferences: UserPreferences) {
  try {
    localStorage.setItem(userPreferencesStorageKey(userId), JSON.stringify(preferences));
  } catch {
    // D1 is authoritative. A full/disabled browser cache must not fail a successful save.
  }
}

export function readLegacyUserPreferences(userId: string, teamId: string): UserPreferences {
  const preferences = { ...defaultUserPreferences };
  try {
    // The old delay key has no user ID. Claim it once before writing any new cache.
    const owner = localStorage.getItem(legacyOwnerKey);
    if (owner === null) localStorage.setItem(legacyOwnerKey, userId);
    if (owner === null || owner === userId) {
      const delay: unknown = JSON.parse(
        localStorage.getItem("kaji:todo-completion-delay-ms:v1") ?? "null",
      );
      if (
        typeof delay === "number" &&
        Number.isInteger(delay) &&
        delay >= 100 &&
        delay <= 5000 &&
        delay % 100 === 0
      ) {
        preferences.todoCompletionDelayMs = Math.max(
          1000,
          Math.round(delay / 1000) * 1000,
        ) as UserPreferences["todoCompletionDelayMs"];
      }
    }
  } catch {
    // Browser-wide legacy settings cannot be attributed safely if storage is unavailable.
  }
  try {
    const category = TodoCategorySelectionSchema.safeParse(
      JSON.parse(
        localStorage.getItem(`kaji:todo-default-category:v1:${userId}:${teamId}`) ?? "null",
      ),
    );
    if (category.success) preferences.defaultTodoCategory = category.data;
  } catch {
    // The per-user legacy category is independent of browser-wide migration.
  }
  return preferences;
}
