// API_ORIGIN is configured per environment in the Cloudflare dashboard and is
// intentionally absent from wrangler.toml because keep_vars preserves it.
type WorkerEnv = Env & {
  API_ORIGIN?: string;
};

type RequestHandlerDependencies = {
  apiOrigin?: string;
  fetchAsset: (request: Request) => Promise<Response>;
  fetchUpstream: (request: Request) => Promise<Response>;
};

const noCachePaths = new Set([
  "/sw.js",
  "/registerSW.js",
  "/manifest.webmanifest",
]);

function parseAPIOrigin(value: string | undefined): URL | null {
  if (value == null || value.trim() === "") {
    return null;
  }

  try {
    const origin = new URL(value.trim());
    const isLocalHTTP =
      origin.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    if (
      (origin.protocol !== "https:" && !isLocalHTTP) ||
      origin.username !== "" ||
      origin.password !== "" ||
      origin.pathname !== "/" ||
      origin.search !== "" ||
      origin.hash !== ""
    ) {
      return null;
    }
    return origin;
  } catch {
    return null;
  }
}

function withAssetHeaders(response: Response, pathname: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  if (noCachePaths.has(pathname)) {
    headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isAPIPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export async function handleRequest(
  request: Request,
  dependencies: RequestHandlerDependencies,
): Promise<Response> {
  const requestURL = new URL(request.url);
  if (!isAPIPath(requestURL.pathname)) {
    const response = await dependencies.fetchAsset(request);
    return withAssetHeaders(response, requestURL.pathname);
  }

  const apiOrigin = parseAPIOrigin(dependencies.apiOrigin);
  if (apiOrigin == null) {
    return new Response("Service unavailable", { status: 503 });
  }

  const upstreamURL = new URL(
    requestURL.pathname.slice("/api".length) || "/",
    apiOrigin,
  );
  upstreamURL.search = requestURL.search;

  try {
    return await dependencies.fetchUpstream(new Request(upstreamURL, request));
  } catch (error) {
    console.error("API proxy request failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      method: request.method,
      pathname: requestURL.pathname,
    });
    return new Response("Bad gateway", { status: 502 });
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, {
      apiOrigin: env.API_ORIGIN,
      fetchAsset: (assetRequest) => env.ASSETS.fetch(assetRequest),
      fetchUpstream: (upstreamRequest) => fetch(upstreamRequest),
    });
  },
} satisfies ExportedHandler<WorkerEnv>;
