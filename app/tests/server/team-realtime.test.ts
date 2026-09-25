import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../helpers/d1";
import { session, user } from "../../src/server/infrastructure/auth-schema";
import { teamMembers } from "../../src/server/infrastructure/schema";
import { provisionUser } from "../../src/server/application/provision-user";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      protected ctx: DurableObjectState,
      protected env: Env,
    ) {}
  },
}));
import { TeamRealtime } from "../../src/server/infrastructure/team-realtime";

let connection: Awaited<ReturnType<typeof createTestDatabase>>;
const now = new Date();
let teamId: string;
const sockets: Socket[] = [];
class Socket {
  readyState = 1;
  messages: { type: string; userIds?: string[] }[] = [];
  constructor(private attachment: unknown) {}
  deserializeAttachment() {
    return this.attachment;
  }
  send(message: string) {
    this.messages.push(JSON.parse(message));
  }
  close = vi.fn(() => {
    this.readyState = 3;
  });
}
function restoreObject(getWebSockets = () => sockets.filter((s) => s.readyState === 1)) {
  // 新しいインスタンスにはメモリー状態を引き継がず、公式attachment APIだけを復元する。
  return new TeamRealtime(
    {
      getWebSockets,
      blockConcurrencyWhile: (callback: () => Promise<void>) => callback(),
    } as unknown as DurableObjectState,
    { DB: connection.binding } as Env,
  );
}
beforeAll(async () => {
  connection = await createTestDatabase();
  vi.stubGlobal("WebSocket", { OPEN: 1 });
  for (const id of ["a", "b"]) {
    await connection.db.insert(user).values({ id, name: id, email: `${id}@example.com` });
    await provisionUser(connection.repository, id, now);
  }
  teamId = (await connection.repository.ListMembershipsByUserID("a"))[0].TeamID;
  await connection.db
    .update(teamMembers)
    .set({ team_id: teamId })
    .where(eq(teamMembers.user_id, "b"));
  for (const id of ["a", "b"])
    await connection.db
      .insert(session)
      .values({ id, token: id, userId: id, expiresAt: new Date(now.getTime() + 60_000) });
});
it("never delivers to a connection outside the authorization snapshot", async () => {
  const authorized = new Socket({ userId: "a", sessionId: "a", teamId });
  const unchecked = new Socket({ userId: "unknown", sessionId: "unknown", teamId });
  const getWebSockets = vi
    .fn()
    .mockReturnValueOnce([authorized])
    .mockReturnValue([authorized, unchecked]);

  await restoreObject(getWebSockets).notify();
  expect(authorized.messages).toEqual([
    { type: "presence", userIds: ["a"] },
    { type: "team-changed" },
  ]);
  expect(unchecked.messages).toEqual([]);
});

it("rejects missing attachments without publishing an unverified identity", async () => {
  const invalid = new Socket(null);
  const valid = new Socket({ userId: "a", sessionId: "a", teamId });
  await restoreObject(() => [invalid, valid]).notify();
  expect(invalid.close).toHaveBeenCalledWith(1008, "Invalid connection identity");
  expect(invalid.messages).toEqual([]);
  expect(valid.messages[0]).toEqual({ type: "presence", userIds: ["a"] });
});

it("closes connections for retry if identity recovery fails, without propagating the error", async () => {
  const socket = new Socket(null);
  vi.spyOn(socket, "deserializeAttachment").mockImplementation(() => {
    throw new Error("attachment unavailable");
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(restoreObject(() => [socket]).notify()).resolves.toBeUndefined();
    expect(socket.close).toHaveBeenCalledWith(1011, "Connection unavailable");
    expect(socket.messages).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ event: "team_broadcast_failed", errorName: "Error" }),
    );
  } finally {
    log.mockRestore();
  }
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await connection?.close();
});
it("restores attachments, deduplicates members, and removes only the last connection", async () => {
  sockets.push(
    new Socket({ userId: "a", sessionId: "a", teamId }),
    new Socket({ userId: "b", sessionId: "b", teamId }),
    new Socket({ userId: "b", sessionId: "b", teamId }),
  );
  await restoreObject().notify();
  expect(sockets[0].messages).toEqual([
    { type: "presence", userIds: ["a", "b"] },
    { type: "team-changed" },
  ]);
  await restoreObject().webSocketClose(sockets[1] as unknown as WebSocket, 1000);
  expect(sockets[0].messages.at(-1)).toEqual({ type: "presence", userIds: ["a", "b"] });
  await restoreObject().webSocketClose(sockets[2] as unknown as WebSocket, 1000);
  expect(sockets[0].messages.at(-1)).toEqual({ type: "presence", userIds: ["a"] });
});
it("does not deliver to revoked, expired, or departed connections", async () => {
  for (const mode of ["revoked", "expired", "departed"] as const) {
    await connection.db.delete(session).where(eq(session.id, "b"));
    if (mode !== "revoked")
      await connection.db.insert(session).values({
        id: "b",
        token: "b",
        userId: "b",
        expiresAt: mode === "expired" ? new Date(0) : new Date(now.getTime() + 60_000),
      });
    if (mode === "departed")
      await connection.db.delete(teamMembers).where(eq(teamMembers.user_id, "b"));
    const socket = new Socket({ userId: "b", sessionId: "b", teamId });
    sockets.push(socket);
    await restoreObject().notify();
    expect(socket.close).toHaveBeenCalledWith(1008, "Session or membership changed");
    expect(socket.messages).toEqual([]);
    expect(sockets[0].messages.at(-2)).toEqual({ type: "presence", userIds: ["a"] });
  }
});
