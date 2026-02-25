const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

export type ApiRequestError = {
  name: "ApiRequestError";
  message: string;
  status: number;
  code?: string;
  currentEtag?: string;
};

export const isApiRequestError = (value: unknown): value is ApiRequestError => {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ApiRequestError>;
  return (
    candidate.name === "ApiRequestError" &&
    typeof candidate.message === "string" &&
    typeof candidate.status === "number"
  );
};

let latestTeamEtag = "";

export const getLatestTeamEtag = () => latestTeamEtag;

export const setLatestTeamEtag = (value: string) => {
  latestTeamEtag = value;
};

export const customFetch = async <T>(
  url: string,
  options?: RequestInit,
): Promise<T> => {
  const method = (options?.method ?? "GET").toUpperCase();
  const isMutating =
    method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  const requiresTeamPrecondition = isMutating && !url.startsWith("/v1/auth/");
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (options?.body != null && headers["Content-Type"] == null) {
    headers["Content-Type"] = "application/json";
  }
  if (
    requiresTeamPrecondition &&
    latestTeamEtag === "" &&
    headers["If-Match"] == null
  ) {
    throw {
      name: "ApiRequestError",
      message: "最新状態の取得が必要です。画面を更新して再操作してください。",
      status: 428,
      code: "precondition_required",
    } satisfies ApiRequestError;
  }
  if (
    requiresTeamPrecondition &&
    latestTeamEtag !== "" &&
    headers["If-Match"] == null
  ) {
    headers["If-Match"] = latestTeamEtag;
  }

  const response = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    credentials: "include",
    headers,
  });

  const responseEtag = response.headers.get("ETag");
  if (responseEtag != null && responseEtag !== "") {
    latestTeamEtag = responseEtag;
  }

  if (!response.ok) {
    let message = `request failed: ${response.status}`;
    let code: string | undefined;
    let currentEtag: string | undefined;
    try {
      const body = (await response.json()) as {
        message?: string;
        code?: string;
        currentEtag?: string;
      };
      if (typeof body.message === "string" && body.message !== "") {
        message = body.message;
      }
      if (typeof body.code === "string" && body.code !== "") {
        code = body.code;
      }
      if (typeof body.currentEtag === "string" && body.currentEtag !== "") {
        currentEtag = body.currentEtag;
        latestTeamEtag = body.currentEtag;
      }
    } catch {
      // Ignore JSON parse errors for non-JSON error responses.
    }
    throw {
      name: "ApiRequestError",
      message,
      status: response.status,
      code,
      currentEtag,
    } satisfies ApiRequestError;
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
