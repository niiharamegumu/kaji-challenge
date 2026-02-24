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
      if (
        !(await hasValidBasicAuth(
          request,
          basicAuth.username,
          basicAuth.password,
        ))
      ) {
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
      const headers = new Headers(upstreamReq.headers);
      headers.delete("authorization");
      const sanitizedReq = new Request(upstreamReq, { headers });
      return fetch(sanitizedReq);
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

async function hasValidBasicAuth(
  request: Request,
  expectedUsername: string,
  expectedPassword: string,
) {
  const header = request.headers.get("Authorization") ?? "";
  const basicPrefix = "basic ";
  if (header.slice(0, basicPrefix.length).toLowerCase() !== basicPrefix) {
    return false;
  }

  const encoded = header.slice(basicPrefix.length).trim();
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
  const [userOK, passOK] = await Promise.all([
    timingSafeStringEqual(username, expectedUsername),
    timingSafeStringEqual(password, expectedPassword),
  ]);
  return userOK && passOK;
}

async function timingSafeStringEqual(a: string, b: string) {
  const enc = new TextEncoder();
  const [aDigest, bDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return timingSafeBufferEqual(
    new Uint8Array(aDigest),
    new Uint8Array(bDigest),
  );
}

function timingSafeBufferEqual(a: Uint8Array, b: Uint8Array) {
  const subtleWithTimingSafeEqual = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (
      left: ArrayBufferView | ArrayBuffer,
      right: ArrayBufferView | ArrayBuffer,
    ) => boolean;
  };
  if (typeof subtleWithTimingSafeEqual.timingSafeEqual === "function") {
    return subtleWithTimingSafeEqual.timingSafeEqual(a, b);
  }

  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
