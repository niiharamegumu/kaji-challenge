type AssetBinding = {
  fetch(input: Request | URL | string, init?: RequestInit): Promise<Response>;
};

type WorkerEnv = {
  ASSETS: AssetBinding;
  API_ORIGIN: string;
};

export default {
  async fetch(request: Request, env: WorkerEnv) {
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
