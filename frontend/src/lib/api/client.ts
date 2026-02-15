const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";
const SESSION_STORAGE_KEY = "kaji.session.v1";
const LEGACY_TOKEN_KEY = "kaji.accessToken";

type StoredSession = {
  version: 1;
  accessToken: string;
};

const readSession = (): StoredSession | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (raw == null || raw === "") {
    const legacyToken = window.localStorage.getItem(LEGACY_TOKEN_KEY);
    if (legacyToken != null && legacyToken !== "") {
      const migrated: StoredSession = { version: 1, accessToken: legacyToken };
      window.localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify(migrated),
      );
      window.localStorage.removeItem(LEGACY_TOKEN_KEY);
      return migrated;
    }
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (parsed.version !== 1 || typeof parsed.accessToken !== "string") {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    if (parsed.accessToken === "") {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return { version: 1, accessToken: parsed.accessToken };
  } catch {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
};

export const readAccessToken = (): string | null =>
  readSession()?.accessToken ?? null;

export const writeAccessToken = (accessToken: string): void => {
  if (typeof window === "undefined") {
    return;
  }
  const payload: StoredSession = { version: 1, accessToken };
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
};

export const clearAccessToken = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_TOKEN_KEY);
};

export const customFetch = async <T>(
  url: string,
  options?: RequestInit,
): Promise<T> => {
  const token = readAccessToken();
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (options?.body != null && headers["Content-Type"] == null) {
    headers["Content-Type"] = "application/json";
  }
  if (token != null && token !== "" && headers.Authorization == null) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return { status: 204, data: {}, headers: response.headers } as T;
  }

  return {
    status: response.status,
    data: (await response.json()) as unknown,
    headers: response.headers,
  } as T;
};
