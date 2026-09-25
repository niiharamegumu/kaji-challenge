import { beforeEach, expect, it, vi } from "vitest";
import type { RuntimeBindings } from "../../src/server/transport/runtime.server";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  members: vi.fn(),
  fetch: vi.fn(),
  notify: vi.fn(),
  getByName: vi.fn(),
}));
vi.mock("../../src/server/transport/runtime.server", () => ({
  createRuntime: () => ({
    auth: { api: { getSession: mocks.session } },
    repository: { ListMembershipsByUserID: mocks.members },
  }),
}));
import { connectRealtime, notifyTeams } from "../../src/server/transport/realtime.server";
const env = {
  APP_ORIGIN: "https://app.example",
  TEAM_REALTIME: { getByName: mocks.getByName },
} as unknown as RuntimeBindings;
const request = (origin = "https://app.example") =>
  new Request("https://app.example/api/realtime?team=other", {
    headers: {
      Upgrade: "websocket",
      Origin: origin,
      "x-realtime-team": "other",
      "x-realtime-user": "impostor",
    },
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "user" }, session: { id: "session" } });
  mocks.members.mockResolvedValue([{ TeamID: "team" }]);
  mocks.getByName.mockReturnValue({ fetch: mocks.fetch, notify: mocks.notify });
  mocks.fetch.mockResolvedValue(new Response("upgraded"));
});
it("requires same origin, a valid session, and current membership", async () => {
  expect((await connectRealtime(request("https://evil.example"), env)).status).toBe(403);
  mocks.session.mockResolvedValueOnce(null);
  expect((await connectRealtime(request(), env)).status).toBe(401);
  mocks.members.mockResolvedValueOnce([]);
  expect((await connectRealtime(request(), env)).status).toBe(403);
  expect((await connectRealtime(request(), { ...env, MAINTENANCE_MODE: "true" })).status).toBe(503);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it("selects team and identity on the server and ignores caller-supplied identity", async () => {
  await connectRealtime(request(), env);
  expect(mocks.getByName).toHaveBeenCalledExactlyOnceWith("team");
  const forwarded = mocks.fetch.mock.calls[0][0] as Request;
  expect(forwarded.headers.get("x-realtime-team")).toBe("team");
  expect(forwarded.headers.get("x-realtime-user")).toBe("user");
  expect(forwarded.headers.get("x-realtime-session")).toBe("session");
});
it("deduplicates target teams and logs notification failure without failing the save", async () => {
  mocks.notify.mockRejectedValue(new Error("private details"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(notifyTeams(env, ["team", "team"])).resolves.toBeUndefined();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ event: "team_notification_failed", teamId: "team" }),
    );
  } finally {
    log.mockRestore();
  }
});
