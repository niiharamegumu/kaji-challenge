type AssetBinding = {
  fetch(input: Request | URL | string, init?: RequestInit): Promise<Response>;
};

type WorkerEnv = {
  ASSETS: AssetBinding;
  API_ORIGIN: string;
  RELEASE_BASIC_AUTH_ENABLED?: string;
  RELEASE_BASIC_AUTH_USERNAME?: string;
  RELEASE_BASIC_AUTH_PASSWORD?: string;
};

export default {
  async fetch(request: Request, env: WorkerEnv) {
    const basicAuth = getBasicAuthConfig(env);

    if (request.method !== "OPTIONS" && basicAuth.enabled) {
      if (!hasValidBasicAuth(request, basicAuth.username, basicAuth.password)) {
        return new Response("Authentication required", {
          status: 401,
          headers: {
            "WWW-Authenticate": 'Basic realm="Kaji Private"',
          },
        });
      }
    }

    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const apiOrigin = (env.API_ORIGIN ?? "").trim().replace(/\/+$/, "");
      if (apiOrigin === "") {
        return new Response("API_ORIGIN is not configured", { status: 500 });
      }
      const upstreamURL = `${apiOrigin}${url.pathname.replace(/^\/api/, "")}${url.search}`;
      const upstreamReq = new Request(upstreamURL, request);
      return fetch(upstreamReq);
    }
    return env.ASSETS.fetch(request);
  },
};

function getBasicAuthConfig(env: WorkerEnv) {
  const enabled = (env.RELEASE_BASIC_AUTH_ENABLED ?? "").trim() === "true";
  const username = (env.RELEASE_BASIC_AUTH_USERNAME ?? "").trim();
  const password = (env.RELEASE_BASIC_AUTH_PASSWORD ?? "").trim();

  if (enabled && (username === "" || password === "")) {
    throw new Error(
      "RELEASE_BASIC_AUTH_ENABLED=true requires RELEASE_BASIC_AUTH_USERNAME and RELEASE_BASIC_AUTH_PASSWORD",
    );
  }

  return { enabled, username, password };
}

function hasValidBasicAuth(
  request: Request,
  expectedUsername: string,
  expectedPassword: string,
) {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Basic ")) {
    return false;
  }

  const encoded = header.slice("Basic ".length).trim();
  if (encoded === "") {
    return false;
  }

  let decoded = "";
  try {
    decoded = atob(encoded);
  } catch {
    return false;
  }

  const sep = decoded.indexOf(":");
  if (sep < 0) {
    return false;
  }

  const username = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);
  return username === expectedUsername && password === expectedPassword;
}
