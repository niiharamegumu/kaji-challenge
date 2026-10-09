import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { NewMcpConnection } from "../../src/server/application/mcp-ports";
import { session, user } from "../../src/server/infrastructure/auth-schema";
import { D1McpRepository } from "../../src/server/infrastructure/mcp-repository";
import { mcpConsentClaims } from "../../src/server/infrastructure/schema";
import { createTestDatabase } from "../helpers/d1";

const now = "2026-10-09T00:00:00.000Z";
const later = "2026-10-09T00:01:00.000Z";
const expiresAt = "2026-11-08T00:00:00.000Z";
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let repository: D1McpRepository;

beforeAll(async () => {
  database = await createTestDatabase();
  repository = new D1McpRepository(database.db);
});
afterAll(async () => {
  await database?.close();
});

async function createIdentity(sessionExpiry = expiresAt) {
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  await database.db.insert(user).values({
    id: userId,
    name: "MCP fixture",
    email: `${userId}@example.com`,
  });
  await database.db.insert(session).values({
    id: sessionId,
    userId,
    token: crypto.randomUUID(),
    expiresAt: new Date(sessionExpiry),
  });
  return { userId, sessionId };
}

async function createPendingConnection(userId: string, overrides: Partial<NewMcpConnection> = {}) {
  const connection = {
    id: crypto.randomUUID(),
    userId,
    clientId: crypto.randomUUID(),
    clientName: "Fixture client",
    resource: "https://mcp.example.com/mcp",
    scopes: ["todos:read", "todos:write"],
    createdAt: now,
    expiresAt,
    ...overrides,
  };
  await repository.createConnection(connection);
  return connection;
}

async function createClaim(identity: { userId: string; sessionId: string }, claimExpiry = later) {
  const handleHash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(crypto.randomUUID())),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  await repository.createConsentClaim({ ...identity, handleHash, expiresAt: claimExpiry });
  return handleHash;
}

it("round-trips connection scopes and SQL-looking client names and lists only the owner", async () => {
  const owner = await createIdentity();
  const other = await createIdentity();
  const first = await createPendingConnection(owner.userId, {
    clientName: "Client '); DROP TABLE mcp_connections; --",
    scopes: ["todos:read"],
  });
  const second = await createPendingConnection(owner.userId, { createdAt: later });
  await createPendingConnection(other.userId);

  expect(await repository.getConnection(first.id)).toEqual({
    ...first,
    grantId: null,
    revokedAt: null,
  });
  expect((await repository.listConnections(owner.userId)).map((item) => item.id)).toEqual([
    second.id,
    first.id,
  ]);
  expect(await repository.getConnection("absent")).toBeNull();
});

it("consumes a consent claim exactly once under simultaneous submissions", async () => {
  const identity = await createIdentity();
  const handleHash = await createClaim(identity);
  const consumed = await Promise.all(
    Array.from({ length: 5 }, () =>
      repository.consumeConsentClaim(handleHash, identity.userId, identity.sessionId, now),
    ),
  );
  expect(consumed.filter(Boolean)).toHaveLength(1);
  const [claim] = await database.db
    .select()
    .from(mcpConsentClaims)
    .where(eq(mcpConsentClaims.handle_hash, handleHash));
  expect(claim).toEqual({
    handle_hash: handleHash,
    user_id: identity.userId,
    session_id: identity.sessionId,
    expires_at: later,
    consumed_at: now,
  });
  expect(
    await repository.consumeConsentClaim(handleHash, identity.userId, identity.sessionId, now),
  ).toBe(false);
});

it("does not consume another user's or another session's claim", async () => {
  const owner = await createIdentity();
  const other = await createIdentity();
  const handleHash = await createClaim(owner);
  expect(await repository.consumeConsentClaim(handleHash, other.userId, other.sessionId, now)).toBe(
    false,
  );
  expect(await repository.consumeConsentClaim(handleHash, owner.userId, other.sessionId, now)).toBe(
    false,
  );
  expect(await repository.consumeConsentClaim(handleHash, owner.userId, owner.sessionId, now)).toBe(
    true,
  );
});

it("checks session ownership even when a stored claim has mismatched identities", async () => {
  const owner = await createIdentity();
  const other = await createIdentity();
  const handleHash = await createClaim({ userId: owner.userId, sessionId: other.sessionId });
  expect(await repository.consumeConsentClaim(handleHash, owner.userId, other.sessionId, now)).toBe(
    false,
  );
});

it.each([now, "2026-10-08T23:59:59.999Z"])(
  "rejects a claim expiring at or before the current time (%s)",
  async (claimExpiry) => {
    const identity = await createIdentity();
    const handleHash = await createClaim(identity, claimExpiry);
    expect(
      await repository.consumeConsentClaim(handleHash, identity.userId, identity.sessionId, now),
    ).toBe(false);
  },
);

it("rechecks session expiry and session revocation when consuming consent", async () => {
  const expired = await createIdentity(now);
  const expiredHash = await createClaim(expired);
  expect(
    await repository.consumeConsentClaim(expiredHash, expired.userId, expired.sessionId, now),
  ).toBe(false);

  const revoked = await createIdentity();
  const revokedHash = await createClaim(revoked);
  await database.db.delete(session).where(eq(session.id, revoked.sessionId));
  expect(
    await repository.consumeConsentClaim(revokedHash, revoked.userId, revoked.sessionId, now),
  ).toBe(false);
  expect(
    await database.db
      .select()
      .from(mcpConsentClaims)
      .where(eq(mcpConsentClaims.handle_hash, revokedHash)),
  ).toEqual([]);
});

it("binds exactly one grant under simultaneous authorization code exchanges", async () => {
  const { userId } = await createIdentity();
  const connection = await createPendingConnection(userId);
  const grantIds = Array.from({ length: 5 }, () => crypto.randomUUID());
  const results = await Promise.all(
    grantIds.map((grantId) =>
      repository.bindGrant(
        connection.id,
        userId,
        connection.clientId,
        connection.resource,
        grantId,
        now,
      ),
    ),
  );
  expect(results.filter(Boolean)).toHaveLength(1);
  const grantId = grantIds[results.findIndex(Boolean)];
  expect(await repository.getConnection(connection.id)).toMatchObject({ grantId });
  expect(
    await repository.bindGrant(
      connection.id,
      userId,
      connection.clientId,
      connection.resource,
      grantId,
      now,
    ),
  ).toBe(false);
});

it.each(["userId", "clientId", "resource"] as const)(
  "does not bind a grant for mismatched %s",
  async (field) => {
    const { userId } = await createIdentity();
    const connection = await createPendingConnection(userId);
    const mismatched = { ...connection, [field]: "wrong" };
    expect(
      await repository.bindGrant(
        connection.id,
        mismatched.userId,
        mismatched.clientId,
        mismatched.resource,
        crypto.randomUUID(),
        now,
      ),
    ).toBe(false);
    expect(await repository.getConnection(connection.id)).toMatchObject({ grantId: null });
  },
);

it.each(["expired", "revoked"])("does not activate an %s connection", async (state) => {
  const { userId } = await createIdentity();
  const connection = await createPendingConnection(userId, { expiresAt: later });
  if (state === "revoked") await repository.revokeConnection(connection.id, userId, now);
  expect(
    await repository.bindGrant(
      connection.id,
      userId,
      connection.clientId,
      connection.resource,
      crypto.randomUUID(),
      state === "expired" ? later : now,
    ),
  ).toBe(false);
});

it("allows only the owner to revoke and preserves the first revocation time", async () => {
  const owner = await createIdentity();
  const other = await createIdentity();
  const connection = await createPendingConnection(owner.userId);
  const grantId = crypto.randomUUID();
  await repository.bindGrant(
    connection.id,
    owner.userId,
    connection.clientId,
    connection.resource,
    grantId,
    now,
  );
  expect(await repository.revokeConnection(connection.id, other.userId, now)).toBeNull();
  expect(await repository.getConnection(connection.id)).toMatchObject({ revokedAt: null });
  expect(await repository.revokeConnection(connection.id, owner.userId, now)).toMatchObject({
    grantId,
    revokedAt: now,
  });
  expect(await repository.revokeConnection(connection.id, owner.userId, later)).toMatchObject({
    grantId,
    revokedAt: now,
  });
  expect(await repository.revokeConnection("absent", owner.userId, now)).toBeNull();
});

it("keeps a granted connection independent of browser logout", async () => {
  const identity = await createIdentity();
  const connection = await createPendingConnection(identity.userId);
  const grantId = crypto.randomUUID();
  await repository.bindGrant(
    connection.id,
    identity.userId,
    connection.clientId,
    connection.resource,
    grantId,
    now,
  );
  await database.db.delete(session).where(eq(session.id, identity.sessionId));
  expect(await repository.getConnection(connection.id)).toMatchObject({
    grantId,
    revokedAt: null,
  });
});

it.each(["userId", "clientId", "grantId"] as const)(
  "does not revoke a verified grant whose %s does not match the connection",
  async (field) => {
    const { userId } = await createIdentity();
    const connection = await createPendingConnection(userId);
    const grantId = crypto.randomUUID();
    await repository.bindGrant(
      connection.id,
      userId,
      connection.clientId,
      connection.resource,
      grantId,
      now,
    );
    const identity = { userId, clientId: connection.clientId, grantId, [field]: "wrong" };
    expect(
      await repository.revokeGrantConnection(
        identity.userId,
        identity.clientId,
        identity.grantId,
        now,
      ),
    ).toBe(false);
    expect(await repository.getConnection(connection.id)).toMatchObject({ revokedAt: null });
  },
);

it("revokes a verified grant concurrently and retains its first revocation time", async () => {
  const { userId } = await createIdentity();
  const connection = await createPendingConnection(userId);
  const grantId = crypto.randomUUID();
  await repository.bindGrant(
    connection.id,
    userId,
    connection.clientId,
    connection.resource,
    grantId,
    now,
  );
  expect(
    await Promise.all(
      Array.from({ length: 4 }, () =>
        repository.revokeGrantConnection(userId, connection.clientId, grantId, now),
      ),
    ),
  ).toEqual([true, true, true, true]);
  expect(await repository.revokeGrantConnection(userId, connection.clientId, grantId, later)).toBe(
    true,
  );
  expect(await repository.getConnection(connection.id)).toMatchObject({ grantId, revokedAt: now });
  expect(
    await repository.bindGrant(
      connection.id,
      userId,
      connection.clientId,
      connection.resource,
      crypto.randomUUID(),
      later,
    ),
  ).toBe(false);
});

it("cascades user deletion to consent and connections and prevents reactivation", async () => {
  const identity = await createIdentity();
  const connection = await createPendingConnection(identity.userId);
  const handleHash = await createClaim(identity);
  await database.db.delete(user).where(eq(user.id, identity.userId));
  expect(await repository.getConnection(connection.id)).toBeNull();
  expect(await repository.listConnections(identity.userId)).toEqual([]);
  expect(
    await repository.bindGrant(
      connection.id,
      identity.userId,
      connection.clientId,
      connection.resource,
      crypto.randomUUID(),
      now,
    ),
  ).toBe(false);
  expect(
    await repository.consumeConsentClaim(handleHash, identity.userId, identity.sessionId, now),
  ).toBe(false);
  expect(
    await database.db
      .select()
      .from(mcpConsentClaims)
      .where(eq(mcpConsentClaims.handle_hash, handleHash)),
  ).toEqual([]);
  await expect(createPendingConnection(identity.userId)).rejects.toThrow();
  expect(await database.db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
});

it("rejects malformed scope storage and non-positive connection lifetime in D1", async () => {
  const { userId } = await createIdentity();
  const connection = await createPendingConnection(userId);
  for (const invalidScopes of ["not JSON", "{}", '"todos:read"']) {
    await expect(
      database.db.run(
        sql`UPDATE mcp_connections SET scopes = ${invalidScopes} WHERE id = ${connection.id}`,
      ),
    ).rejects.toThrow();
  }
  await expect(createPendingConnection(userId, { expiresAt: now })).rejects.toThrow();
  expect(await repository.getConnection(connection.id)).toMatchObject({
    scopes: ["todos:read", "todos:write"],
  });
});
