import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase } from "../helpers/d1";
import { executeOperation } from "../../src/server/application/operations";
import { operationSchema, responseSchemas } from "../../src/contracts/operations";
import { defaultUserPreferences, type UserPreferences } from "../../src/contracts/user-preferences";

let c: Awaited<ReturnType<typeof createTestDatabase>>;
const own = {
  user: crypto.randomUUID(),
  team: crypto.randomUUID(),
  session: crypto.randomUUID(),
  category: crypto.randomUUID(),
};
const other = {
  user: crypto.randomUUID(),
  team: crypto.randomUUID(),
  session: crypto.randomUUID(),
  category: crypto.randomUUID(),
};
const now = new Date();
beforeAll(async () => {
  c = await createTestDatabase();
  for (const f of [own, other]) {
    await c.query(
      sql`INSERT INTO auth_user(id,name,email) VALUES (${f.user},'Preferences',${f.user + "@example.com"})`,
    );
    await c.repository.ProvisionUser(f.user, f.team, "Team", now.toISOString());
    await c.repository.CreateTodoCategory(f.team, { id: f.category, name: "Category" });
  }
});
beforeEach(async () => {
  await c.query(sql`DELETE FROM user_preferences`);
  for (const f of [own, other]) {
    await c.query(sql`INSERT INTO auth_session(id,token,user_id,expires_at)
      VALUES (${f.session},${f.session},${f.user},'2099-01-01T00:00:00.000Z')
      ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at`);
    await c.query(sql`UPDATE team_members SET team_id=${f.team} WHERE user_id=${f.user}`);
  }
});
afterAll(async () => {
  await c?.close();
});
async function run(
  operation: "getMePreferences" | "patchMePreferences" | "initializeMePreferences",
  body?: unknown,
  f = own,
) {
  const input = operationSchema.parse({
    operation,
    params: {},
    ...(body === undefined ? {} : { body }),
  });
  const result = await executeOperation(c.repository.forSession(f.user, f.session), input, {
    userId: f.user,
    now,
    vapidPublicKey: "",
  });
  return responseSchemas[operation].parse(result.data);
}

it("does not write on reads, initializes once, and preserves unspecified fields on updates", async () => {
  expect(await run("getMePreferences")).toBeNull();
  expect((await c.query(sql`SELECT * FROM user_preferences`)).rows).toHaveLength(0);
  const first: UserPreferences = {
    todoCompletionDelayMs: 5000,
    defaultTodoCategory: { kind: "category", id: own.category },
  };
  expect(await run("initializeMePreferences", first)).toEqual(first);
  expect(await run("initializeMePreferences", defaultUserPreferences)).toEqual(first);
  expect(await run("patchMePreferences", { todoCompletionDelayMs: 1000 })).toEqual({
    ...first,
    todoCompletionDelayMs: 1000,
  });
  expect(await run("getMePreferences", undefined, other)).toBeNull();
});

it("keeps simultaneous changes to separate fields and makes concurrent initialization first-writer-wins", async () => {
  await Promise.all([
    run("initializeMePreferences", {
      ...defaultUserPreferences,
      defaultTodoCategory: { kind: "unclassified" },
    }),
    run("initializeMePreferences", { ...defaultUserPreferences, todoCompletionDelayMs: 5000 }),
  ]);
  const initial = await run("getMePreferences");
  expect([
    { ...defaultUserPreferences, defaultTodoCategory: { kind: "unclassified" } },
    { ...defaultUserPreferences, todoCompletionDelayMs: 5000 },
  ]).toContainEqual(initial);
  await Promise.all([
    run("patchMePreferences", { defaultTodoCategory: { kind: "category", id: own.category } }),
    run("patchMePreferences", { todoCompletionDelayMs: 1000 }),
  ]);
  expect(await run("getMePreferences")).toEqual({
    ...defaultUserPreferences,
    defaultTodoCategory: { kind: "category", id: own.category },
    todoCompletionDelayMs: 1000,
  });
});

it("rejects unavailable categories on explicit saves and safely migrates an obsolete local category", async () => {
  for (const id of [other.category, crypto.randomUUID()]) {
    await expect(
      run("patchMePreferences", { defaultTodoCategory: { kind: "category", id } }),
    ).rejects.toMatchObject({ status: 409 });
  }
  expect(
    await run("initializeMePreferences", {
      ...defaultUserPreferences,
      defaultTodoCategory: { kind: "category", id: other.category },
    }),
  ).toEqual(defaultUserPreferences);
  for (const kind of ["all", "unclassified"]) {
    expect(await run("patchMePreferences", { defaultTodoCategory: { kind } })).toMatchObject({
      defaultTodoCategory: { kind },
    });
  }
});

it("keeps one preference across teams without clearing a category when another field changes", async () => {
  await run("patchMePreferences", { defaultTodoCategory: { kind: "category", id: own.category } });
  const oldRepo = c.repository.forSession(own.user, own.session).forMember(own.team, own.user);
  await c.query(sql`UPDATE team_members SET team_id=${other.team} WHERE user_id=${own.user}`);
  expect(await run("getMePreferences")).toMatchObject({
    defaultTodoCategory: { kind: "category", id: own.category },
  });
  expect(await run("patchMePreferences", { todoCompletionDelayMs: 5000 })).toMatchObject({
    todoCompletionDelayMs: 5000,
    defaultTodoCategory: { kind: "category", id: own.category },
  });
  await expect(
    oldRepo.SaveUserPreferences(own.user, { todoCompletionDelayMs: 1000 }),
  ).rejects.toBeDefined();
  expect((await c.query(sql`SELECT * FROM user_preferences`)).rows).toHaveLength(1);
});

it("denies another user's preferences even in the same team", async () => {
  await run("initializeMePreferences", defaultUserPreferences, other);
  await c.query(sql`UPDATE team_members SET team_id=${own.team} WHERE user_id=${other.user}`);
  const repo = c.repository.forSession(own.user, own.session).forMember(own.team, own.user);
  await expect(repo.GetUserPreferences(other.user)).rejects.toBeDefined();
  await expect(
    repo.SaveUserPreferences(other.user, { todoCompletionDelayMs: 5000 }),
  ).rejects.toBeDefined();
  await expect(
    repo.SaveUserPreferences(other.user, defaultUserPreferences, true),
  ).rejects.toBeDefined();
  expect(await run("getMePreferences", undefined, other)).toEqual(defaultUserPreferences);
});

it.each(["revoked", "expired", "left"])("checks %s access again inside SQL", async (state) => {
  await run("initializeMePreferences", defaultUserPreferences);
  const repo = c.repository.forSession(own.user, own.session).forMember(own.team, own.user);
  if (state === "revoked") await c.query(sql`DELETE FROM auth_session WHERE id=${own.session}`);
  if (state === "expired")
    await c.query(
      sql`UPDATE auth_session SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=${own.session}`,
    );
  if (state === "left")
    await c.query(sql`UPDATE team_members SET team_id=${other.team} WHERE user_id=${own.user}`);
  await expect(repo.GetUserPreferences(own.user)).rejects.toBeDefined();
  await expect(
    repo.SaveUserPreferences(own.user, { todoCompletionDelayMs: 5000 }),
  ).rejects.toBeDefined();
  expect(
    (
      await c.query(
        sql`SELECT todo_completion_delay_ms FROM user_preferences WHERE user_id=${own.user}`,
      )
    ).rows,
  ).toEqual([{ todo_completion_delay_ms: 3000 }]);
});

it.each([
  {},
  { theme: "dark" },
  { todoCompletionDelayMs: 5000, theme: "dark" },
  { todoCompletionDelayMs: 1700 },
  { todoCompletionDelayMs: "3000" },
  { defaultTodoCategory: null },
  { defaultTodoCategory: { kind: "category", id: "invalid" } },
  { todoCompletionDelayMs: 5000, userId: own.user },
  { todoCompletionDelayMs: 5000, teamId: own.team },
])("rejects malformed/forged preference input: %j", (body) => {
  expect(operationSchema.safeParse({ operation: "patchMePreferences", body }).success).toBe(false);
});
it("rejects identity parameters and validates the output contract", () => {
  expect(
    operationSchema.safeParse({ operation: "getMePreferences", params: { userId: other.user } })
      .success,
  ).toBe(false);
  expect(
    responseSchemas.patchMePreferences.safeParse({
      ...defaultUserPreferences,
      todoCompletionDelayMs: 8000,
    }).success,
  ).toBe(false);
});
