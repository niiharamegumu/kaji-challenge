const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

export const customFetch = async <T>(
  url: string,
  options?: RequestInit,
): Promise<T> => {
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (options?.body != null && headers["Content-Type"] == null) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    credentials: "include",
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
