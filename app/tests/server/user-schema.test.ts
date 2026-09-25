import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { unstable_splitSqlQuery } from "wrangler";
import { sql } from "drizzle-orm";
import { session, rateLimit, verification } from "../../src/server/infrastructure/auth-schema";
import { beforeAll, afterAll, expect, it } from "vitest";
import { createTestDatabase } from "../helpers/d1";
import { createAuth } from "../../src/server/infrastructure/auth";
import { provisionUser } from "../../src/server/application/provision-user";

let connection: Awaited<ReturnType<typeof createTestDatabase>>;
let snapshots: Record<string, unknown[]>;
const id = crypto.randomUUID(),
  team = crypto.randomUUID(),
  task = crypto.randomUUID(),
  sub = crypto.randomUUID();
const tables = [
  "teams",
  "team_members",
  "tasks",
  "task_completion_daily",
  "task_completion_weekly_entries",
  "push_subscriptions",
  "push_delivery",
  "auth_session",
  "auth_account",
  "auth_verification",
  "auth_rate_limit",
];
beforeAll(async () => {
  connection = await createTestDatabase(undefined, "0001_initial.sql");
  const seed = [
    sql`INSERT INTO auth_verification(id,identifier,value,expires_at,created_at,updated_at) VALUES('state','state-key','state-value',1790124547969,1700000000123,1700000000456)`,
    sql`INSERT INTO auth_rate_limit(id,key,count,last_request) VALUES('limit','historical-limit',3,1790124547969)`,
    sql`INSERT INTO auth_user(id,name,email,created_at) VALUES(${id},'Current Google name','current@example.com',1700000000123)`,
    sql`INSERT INTO auth_account(id,user_id,provider_id,account_id,access_token_expires_at) VALUES('account',${id},'google',${id},1790124547969)`,
    sql`INSERT INTO auth_session(id,token,user_id,expires_at) VALUES('session','existing-token',${id},9999999999999)`,
    sql`INSERT INTO users(id,email,display_name,nickname,color_hex,created_at) VALUES(${id},'stale@example.com','Old copied name','ニックネーム','#12ABEF','2020-01-01T00:00:00.000Z')`,
    sql`INSERT INTO teams(id,name,created_at,state_revision) VALUES(${team},'Team','2026-09-01T00:00:00.000Z','9007199254740993')`,
    sql`INSERT INTO team_members(team_id,user_id,role,created_at) VALUES(${team},${id},'owner','2026-09-01T00:00:00.000Z')`,
    sql`INSERT INTO tasks(id,team_id,title,type,penalty_points,assignee_user_id,required_completions_per_week,sort_key,created_at,updated_at) VALUES(${task},${team},'Task','weekly',1,${id},2,100,'2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z')`,
    sql`INSERT INTO task_completion_daily(task_id,target_date,completed_by_user_id,created_at) VALUES(${task},'2026-09-02',${id},'2026-09-02T00:00:00.000Z')`,
    sql`INSERT INTO task_completion_weekly_entries(id,task_id,week_start,completed_by_user_id,created_at) VALUES('completion',${task},'2026-08-31',${id},'2026-09-02T00:00:00.000Z')`,
    sql`INSERT INTO push_subscriptions(id,team_id,user_id,endpoint,p256dh,auth,platform,is_active,last_seen_at,created_at,updated_at) VALUES(${sub},${team},${id},'https://web.push.apple.com/test','test-key','test-auth','ios_safari_pwa',1,'2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z')`,
    sql`INSERT INTO push_delivery(subscription_id,slot,target_date,endpoint_hash,claim_id,lease_until,sent_at) VALUES(${sub},'daily_2100','2026-09-02','hash','claim',1700000000000,1700000000000)`,
  ];
  for (const statement of seed) await connection.query(statement);
  snapshots = Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => [
        table,
        (await connection.binding.prepare(`SELECT * FROM ${table}`).all()).results,
      ]),
    ),
  );
  const migration = await readFile(
    new URL("../../migrations/0002_unify_users.sql", import.meta.url),
    "utf8",
  );
  await connection.binding.batch(
    unstable_splitSqlQuery(migration).map((q) => connection.binding.prepare(q)),
  );
  // The identity migration preserves the original rows verbatim.
  for (const table of Object.keys(snapshots))
    expect((await connection.binding.prepare(`SELECT * FROM ${table}`).all()).results).toEqual(
      snapshots[table],
    );
  snapshots.auth_user = (await connection.binding.prepare("SELECT * FROM auth_user").all()).results;
  const timestampColumns: Record<string, string[]> = {
    auth_user: ["created_at", "updated_at"],
    auth_account: [
      "created_at",
      "updated_at",
      "access_token_expires_at",
      "refresh_token_expires_at",
    ],
    auth_session: ["created_at", "updated_at", "expires_at"],
    auth_verification: ["created_at", "updated_at", "expires_at"],
    auth_rate_limit: ["last_request"],
    push_delivery: ["lease_until", "sent_at"],
  };
  for (const [table, columns] of Object.entries(timestampColumns))
    snapshots[table] = snapshots[table].map((row) => {
      const converted = { ...(row as Record<string, unknown>) };
      for (const column of columns)
        if (converted[column] !== null)
          converted[column] = new Date(converted[column] as number).toISOString();
      return converted;
    });
  const timestamps = await readFile(
    new URL("../../migrations/0003_iso_timestamps.sql", import.meta.url),
    "utf8",
  );
  await connection.binding.batch(
    unstable_splitSqlQuery(timestamps).map((q) => connection.binding.prepare(q)),
  );
  const revisions = await readFile(
    new URL("../../migrations/0004_remove_revisions.sql", import.meta.url),
    "utf8",
  );
  await connection.binding.batch(
    unstable_splitSqlQuery(revisions).map((q) => connection.binding.prepare(q)),
  );
  snapshots.teams = snapshots.teams.map((row) => {
    const kept = { ...(row as Record<string, unknown>) };
    delete kept.state_revision;
    return kept;
  });
});
afterAll(async () => {
  await connection?.close();
});
it("preserves memberships, assignments, completions, subscriptions, sent ledger and sessions", async () => {
  for (const table of Object.keys(snapshots))
    expect((await connection.binding.prepare(`SELECT * FROM ${table}`).all()).results).toEqual(
      snapshots[table],
    );
  expect((await connection.binding.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  expect(
    await connection.binding
      .prepare("SELECT name FROM sqlite_master WHERE name='users' OR name LIKE '_saved_%'")
      .first(),
  ).toBeNull();
  expect(
    (await connection.binding.prepare("PRAGMA foreign_key_list(team_members)").all()).results,
  ).toContainEqual(expect.objectContaining({ table: "auth_user" }));
});
it("uses canonical auth identity while preserving application preferences", async () => {
  expect(await connection.repository.GetUserByID(id)).toMatchObject({
    Email: "current@example.com",
    DisplayName: "Current Google name",
    Nickname: "ニックネーム",
    ColorHex: "#12ABEF",
    CreatedAt: new Date(1700000000123).toISOString(),
  });
});
it("does not let Better Auth update-user bypass application authorization for preferences", async () => {
  const secret = "test-profile-fields-secret-at-least-32-characters";
  const auth = createAuth(connection.db, {
    baseURL: "https://app.example.com",
    secret,
    googleClientId: "test",
    googleClientSecret: "test",
    allowedEmails: ["current@example.com"],
  });
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(id);
  if (!session) throw new Error("No session");
  const signature = createHmac("sha256", secret).update(session.token).digest("base64");
  const update = (body: Record<string, string>) =>
    auth.handler(
      new Request("https://app.example.com/api/auth/update-user", {
        method: "POST",
        headers: {
          origin: "https://app.example.com",
          "content-type": "application/json",
          cookie: `__Secure-better-auth.session_token=${encodeURIComponent(session.token + "." + signature)}`,
        },
        body: JSON.stringify(body),
      }),
    );
  for (const field of [{ nickname: "Unauthorized" }, { colorHex: "#FFFFFF" }] as Record<
    string,
    string
  >[]) {
    const rejected = await update({ name: "Blocked", ...field });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ code: "FIELD_NOT_ALLOWED" });
  }
  expect((await update({ name: "New canonical name" })).status).toBe(200);
  expect(await connection.repository.GetUserByID(id)).toMatchObject({
    DisplayName: "New canonical name",
    Nickname: "ニックネーム",
    ColorHex: "#12ABEF",
  });
  await connection.repository.UpdateUserNickname({ ID: id, Nickname: "業務API" });
  await connection.repository.UpdateUserColorHex({ ID: id, ColorHex: "#AABBCC" });
  expect(await connection.repository.GetUserByID(id)).toMatchObject({
    Nickname: "業務API",
    ColorHex: "#AABBCC",
  });
  await connection.repository.UpdateUserNickname({ ID: id, Nickname: "" });
  await connection.repository.UpdateUserColorHex({ ID: id, ColorHex: "" });
  expect(await connection.repository.GetUserByID(id)).toMatchObject({
    Nickname: "",
    ColorHex: null,
  });
});
it("creates one initial team during simultaneous first logins", async () => {
  const userId = crypto.randomUUID();
  await connection.query(
    sql`INSERT INTO auth_user(id,name,email) VALUES(${userId},'Concurrent',${userId + "@example.com"})`,
  );
  await Promise.all([
    provisionUser(connection.repository, userId, new Date()),
    provisionUser(connection.repository, userId, new Date()),
  ]);
  expect(await connection.repository.ListMembershipsByUserID(userId)).toHaveLength(1);
  // No orphan team may be left by a losing batch, regardless of the display-name convention.
  expect(
    (
      await connection.query(
        sql`SELECT id FROM teams WHERE NOT EXISTS(SELECT 1 FROM team_members m WHERE m.team_id=teams.id)`,
      )
    ).rows,
  ).toEqual([]);
});

it("uses verification and rate-limit storage during Google OAuth initiation", async () => {
  const auth = createAuth(connection.db, {
    baseURL: "https://app.example.com",
    secret: "oauth-state-test-secret-at-least-32-characters",
    googleClientId: "test",
    googleClientSecret: "test",
    allowedEmails: ["current@example.com"],
  });
  const response = await auth.handler(
    new Request("https://app.example.com/api/auth/sign-in/social", {
      method: "POST",
      headers: {
        origin: "https://app.example.com",
        "content-type": "application/json",
        "cf-connecting-ip": "192.0.2.1",
      },
      body: JSON.stringify({ provider: "google", callbackURL: "https://app.example.com/" }),
    }),
  );
  expect(response.status).toBe(200);
  expect(
    await connection.binding
      .prepare("SELECT count(*) AS n FROM auth_verification")
      .first<number>("n"),
  ).toBeGreaterThan(0);
  expect(
    await connection.binding
      .prepare("SELECT count(*) AS n FROM auth_rate_limit")
      .first<number>("n"),
  ).toBeGreaterThan(0);
});

it("keeps migrated timestamps at millisecond precision and SQL defaults canonical", async () => {
  const [stored] = await connection.db
    .select()
    .from(verification)
    .where(sql`id='state'`);
  expect(stored.expiresAt).toEqual(new Date(1790124547969));
  expect(stored.createdAt).toEqual(new Date(1700000000123));
  expect(stored.updatedAt).toEqual(new Date(1700000000456));
  const [limit] = await connection.db
    .select()
    .from(rateLimit)
    .where(sql`id='limit'`);
  expect(limit.lastRequest).toBe(1790124547969);
  const raw = await connection.binding
    .prepare("SELECT created_at,updated_at FROM auth_user WHERE id=?")
    .bind(id)
    .first();
  expect(raw).toMatchObject({
    created_at: "2023-11-14T22:13:20.123Z",
    updated_at: expect.stringMatching(/^\d{4}-.*\.\d{3}Z$/),
  });
});

it("lists only unexpired ISO sessions and removes expired verification values", async () => {
  const auth = createAuth(connection.db, {
    baseURL: "https://app.example.com",
    secret: "iso-dates-test-secret-at-least-32-characters",
    googleClientId: "test",
    googleClientSecret: "test",
    allowedEmails: ["current@example.com"],
  });
  const context = await auth.$context;
  await connection.db.insert(session).values({
    id: "expired-iso",
    token: "expired-iso",
    userId: id,
    expiresAt: new Date(Date.now() - 60000),
  });
  const active = await context.internalAdapter.listSessions(id, { onlyActiveSessions: true });
  expect(active.length).toBeGreaterThan(0);
  expect(active.every((s) => s.expiresAt instanceof Date && s.expiresAt > new Date())).toBe(true);
  expect(active.some((s) => s.id === "expired-iso")).toBe(false);
  await connection.db.insert(verification).values({
    id: "expired-iso",
    identifier: "expired-iso",
    value: "test",
    expiresAt: new Date(Date.now() - 60000),
  });
  await context.internalAdapter.findVerificationValue("missing-iso");
  expect(
    await connection.binding
      .prepare("SELECT id FROM auth_verification WHERE id='expired-iso'")
      .first(),
  ).toBeNull();
});

it("increments, blocks and resets rate limiting with ISO storage", async () => {
  const auth = createAuth(connection.db, {
    baseURL: "https://app.example.com",
    secret: "iso-limit-test-secret-at-least-32-characters",
    googleClientId: "test",
    googleClientSecret: "test",
    allowedEmails: ["current@example.com"],
  });
  const request = () =>
    auth.handler(
      new Request("https://app.example.com/api/auth/get-session", {
        headers: { "cf-connecting-ip": "192.0.2.99" },
      }),
    );
  expect((await request()).status).toBe(200);
  expect((await request()).status).toBe(200);
  const row = await connection.binding
    .prepare("SELECT id,count,last_request FROM auth_rate_limit WHERE key LIKE '%192.0.2.99%'")
    .first<{ id: string; count: number; last_request: string }>();
  expect(row?.count).toBe(2);
  expect(row?.last_request).toMatch(/^\d{4}-.*\.\d{3}Z$/);
  await connection.binding
    .prepare("UPDATE auth_rate_limit SET count=100 WHERE id=?")
    .bind(row!.id)
    .run();
  const blocked = await request();
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers.get("x-retry-after"))).toBeGreaterThan(0);
  await connection.binding
    .prepare("UPDATE auth_rate_limit SET last_request=? WHERE id=?")
    .bind(new Date(Date.now() - 61000).toISOString(), row!.id)
    .run();
  expect((await request()).status).toBe(200);
  expect(
    await connection.binding
      .prepare("SELECT count FROM auth_rate_limit WHERE id=?")
      .bind(row!.id)
      .first("count"),
  ).toBe(1);
});

it("removes revision storage without adding replacement counters", async () => {
  expect(
    await connection.binding
      .prepare("SELECT name FROM sqlite_master WHERE name='app_revision'")
      .first(),
  ).toBeNull();
  expect(
    (await connection.binding.prepare("PRAGMA table_info(teams)").all()).results.map(
      (row) => row.name,
    ),
  ).not.toContain("state_revision");
});
