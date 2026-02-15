const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

export const customFetch = async <T>(
  url: string,
  options?: RequestInit,
): Promise<T> => {
  const token =
    typeof window !== "undefined"
      ? window.localStorage.getItem("kaji.accessToken")
      : null;
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
