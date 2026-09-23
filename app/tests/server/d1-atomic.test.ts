import { and, count, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { teams } from "../../src/server/infrastructure/schema";
import { user } from "../../src/server/infrastructure/auth-schema";
import { afterAll, beforeAll, expect, it } from "vitest";
import { atomic } from "../../src/server/infrastructure/unit-of-work";
import { createTestDatabase } from "../helpers/d1";
let connection: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  connection = await createTestDatabase();
});
afterAll(async () => {
  await connection?.close();
});
const team = (id: string) => ({
  id,
  name: "Initial",
  created_at: new Date().toISOString(),
  state_revision: "0",
});
it("initializes all constraints with no broken foreign keys", async () => {
  expect((await connection.binding.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  await expect(
    connection.binding
      .prepare(
        "INSERT INTO auth_session(id,token,user_id,expires_at) VALUES ('orphan','orphan','orphan','1970-01-01T00:00:00.001Z')",
      )
      .run(),
  ).rejects.toThrow("FOREIGN KEY constraint failed");
});
it("discards the entire D1 batch and global revision on a late constraint failure", async () => {
  const db = connection.binding;
  const before = await db.prepare("SELECT revision FROM app_revision").first("revision");
  await expect(
    atomic(connection.db, async (unit) => {
      await unit.insert(teams, team("duplicate"));
      await unit.insert(teams, team("duplicate"));
    }),
  ).rejects.toThrow("UNIQUE constraint failed");
  expect(await db.prepare("SELECT id FROM teams WHERE id='duplicate'").first()).toBeNull();
  expect(await db.prepare("SELECT revision FROM app_revision").first("revision")).toBe(before);
});
it("retries simultaneous transactions without losing either update", async () => {
  const db = connection.binding;
  await atomic(connection.db, async (unit) => {
    await unit.insert(teams, team("concurrent"));
  });
  let entered = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const update = () =>
    atomic(connection.db, async (unit) => {
      const rows = await unit.read.select().from(teams).where(eq(teams.id, "concurrent"));
      entered++;
      if (entered === 2) release();
      await barrier;
      await unit.update(teams, eq(teams.id, "concurrent"), {
        state_revision: String(BigInt(rows[0].state_revision!) + 1n),
      });
    });
  await Promise.all([update(), update()]);
  expect(
    await db
      .prepare("SELECT state_revision FROM teams WHERE id='concurrent'")
      .first("state_revision"),
  ).toBe("2");
  expect(entered).toBe(3);
});
it("joins and aggregates pending rows, including update and deletion, before commit", async () => {
  await atomic(connection.db, async (unit) => {
    await unit.insert(teams, team("pending"));
    await unit.update(teams, eq(teams.id, "pending"), { name: "Changed" });
    const other = alias(teams, "other");
    expect(
      await unit.read
        .select({ total: count() })
        .from(teams)
        .innerJoin(other, eq(teams.id, other.id))
        .where(eq(teams.name, "Changed")),
    ).toEqual([{ total: 1 }]);
    await unit.remove(teams, eq(teams.id, "pending"));
    expect(await unit.read.select().from(teams).where(eq(teams.id, "pending"))).toEqual([]);
  });
  expect(
    await connection.binding.prepare("SELECT * FROM teams WHERE id='pending'").first(),
  ).toBeNull();
});

it("preserves Drizzle Date/boolean codecs and nulls in staged joins and after commit", async () => {
  const id = "codec-user";
  const now = new Date("2026-09-23T03:04:05.678Z");
  await connection.db.insert(user).values({
    id,
    name: "Codec",
    email: "codec@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await atomic(connection.db, async (unit) => {
    await unit.update(user, eq(user.id, id), {
      nickname: "日本語",
      colorHex: "#123abc",
      updatedAt: now,
    });
    const [staged] = await unit.read.select().from(user).where(eq(user.id, id));
    expect(staged).toMatchObject({
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
      nickname: "日本語",
      colorHex: "#123abc",
    });
    // Parameters remain values even when they contain SQL-looking content.
    const name = "O'Reilly ? $1 ); DROP TABLE teams; --";
    await unit.insert(teams, { ...team("codec-team"), name });
    expect(
      await unit.read
        .select({ nickname: user.nickname, name: teams.name })
        .from(user)
        .innerJoin(teams, and(eq(teams.id, "codec-team"), eq(user.id, id))),
    ).toEqual([{ nickname: "日本語", name }]);
    await unit.update(user, eq(user.id, id), { nickname: null });
    expect((await unit.read.select().from(user).where(eq(user.id, id)))[0].nickname).toBeNull();
  });
  expect((await connection.db.select().from(user).where(eq(user.id, id)))[0]).toMatchObject({
    emailVerified: true,
    nickname: null,
    colorHex: "#123abc",
    updatedAt: now,
  });
  const [stored] = await connection.db.all(
    sql`SELECT email_verified, updated_at FROM auth_user WHERE id=${id}`,
  );
  expect(stored).toEqual({ email_verified: 1, updated_at: now.toISOString() });
});
