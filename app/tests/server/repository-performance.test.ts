import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase } from "../helpers/d1";
import { createDatabase } from "../../src/server/infrastructure/database";
import { user } from "../../src/server/infrastructure/auth-schema";
import { tasks } from "../../src/server/infrastructure/schema";
import { provisionUser } from "../../src/server/application/provision-user";
import { addDays, midnightJST } from "../../src/server/domain/dates";
import { requiredForWeek } from "../../src/server/domain/task-requirements";

let c: Awaited<ReturnType<typeof createTestDatabase>>;
let teamId: string;
const userId = "performance-member";
const taskId = "performance-weekly";
const created = "2015-01-01T00:00:00.000Z";
const week = "2026-09-28";

function observedDatabase() {
  let query = "";
  let parameters: unknown[] = [];
  const database = createDatabase(
    new Proxy(c.binding, {
      get(target, property) {
        if (property === "prepare")
          return (statement: string) => {
            const prepared = target.prepare(statement);
            return new Proxy(prepared, {
              get(statementTarget, key) {
                if (key === "bind")
                  return (...values: unknown[]) => {
                    query = statement;
                    parameters = values;
                    return statementTarget.bind(...values);
                  };
                const value = Reflect.get(statementTarget, key, statementTarget);
                return typeof value === "function" ? value.bind(statementTarget) : value;
              },
            });
          };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
  );
  return { ...database, statement: () => ({ query, parameters }) };
}

beforeAll(async () => {
  c = await createTestDatabase();
  await c.db.insert(user).values({ id: userId, name: "Performance", email: "perf@example.com" });
  await provisionUser(c.repository, userId, new Date(created));
  teamId = (await c.repository.ListMembershipsByUserID(userId))[0].TeamID;
  await c.db.insert(tasks).values({
    id: taskId,
    team_id: teamId,
    title: "Weekly",
    type: "weekly",
    penalty_points: 1,
    required_completions_per_week: 1,
    sort_key: 100,
    created_at: created,
    updated_at: created,
  });
  const requirements = Array.from({ length: 700 }, (_, i) => ({
    week: addDays("2015-01-05", i * 7),
    count: (i % 7) + 1,
  }));
  await c.db.run(sql`INSERT INTO task_weekly_requirements
    SELECT ${taskId},json_extract(value,'$.week'),json_extract(value,'$.count')
    FROM json_each(${JSON.stringify(requirements)})`);
});

afterAll(async () => {
  await c?.close();
});

it("reads only the current and next weekly settings instead of the entire history", async () => {
  const observed = observedDatabase();
  const repository = observed.repository.forMember(teamId, userId);
  const all = await repository.GetTaskByID(taskId);
  expect(all.WeeklyRequirements).toHaveLength(700);
  const window = { fromWeek: week, includeNext: true };
  for (const row of [
    await repository.GetTaskByID(taskId, window),
    ...(await repository.ListTasksByTeamID(teamId, window)),
  ]) {
    expect(row.WeeklyRequirements?.length).toBe(2);
    expect(row.WeeklyRequirements?.map((entry) => entry.effectiveWeek)).toEqual([
      week,
      "2026-10-05",
    ]);
    expect(requiredForWeek(row, week)).toBe(requiredForWeek(all, week));
  }
  const { query, parameters } = observed.statement();
  const result = await c.binding
    .prepare(query)
    .bind(...parameters)
    .all();
  // Count actual D1 reads so bounded output cannot hide a full history scan.
  expect(result.meta.rows_read).toBeLessThan(100);
});

it("keeps the baseline and only the changes needed by a historical month", async () => {
  const repository = c.repository.forMember(teamId, userId);
  const all = await repository.GetTaskByID(taskId);
  const [row] = await repository.ListTasksForMonthlyStatusByTeam({
    TeamID: teamId,
    DeletedAt: midnightJST("2026-09-01"),
    CreatedAt: midnightJST("2026-10-01"),
    RequirementWindow: { fromWeek: "2026-08-31", beforeWeek: "2026-10-01" },
  });
  expect(row.WeeklyRequirements?.length).toBe(5);
  expect(row.WeeklyRequirements?.map((entry) => entry.effectiveWeek)).toEqual([
    "2026-08-31",
    "2026-09-07",
    "2026-09-14",
    "2026-09-21",
    "2026-09-28",
  ]);
  for (let date = "2026-08-31"; date < "2026-10-01"; date = addDays(date, 7))
    expect(requiredForWeek(row, date)).toBe(requiredForWeek(all, date));
  const [push] = await repository.ListTasksEffectiveForCloseByTeamAndType({
    TeamID: teamId,
    Type: "weekly",
    CreatedAt: midnightJST("2026-09-29"),
    RequirementWindow: { fromWeek: week },
  });
  expect(push.WeeklyRequirements).toHaveLength(1);
  expect(requiredForWeek(push, week)).toBe(requiredForWeek(all, week));
});

it("keeps the initial count before the first setting and denies another team with a window", async () => {
  const repository = c.repository.forMember(teamId, userId);
  const row = await repository.GetTaskByID(taskId, { fromWeek: "2014-12-29" });
  expect(row.WeeklyRequirements).toEqual([]);
  expect(requiredForWeek(row, "2014-12-29")).toBe(1);
  expect(await repository.ListTasksByTeamID("another-team", { fromWeek: week })).toEqual([]);
});

it("materializes reorder ranks once and uses an indexed join for a large list", async () => {
  const ids = Array.from({ length: 800 }, (_, i) => `performance-todo-${i}`);
  await c.db.run(sql`INSERT INTO todo_items
    (id,team_id,name,notes,category_id,sort_key,created_at,updated_at)
    SELECT value,${teamId},value,NULL,NULL,(CAST(key AS INTEGER)+1)*100,${created},${created}
    FROM json_each(${JSON.stringify(ids)})`);
  const observed = observedDatabase();
  await observed.repository.forMember(teamId, userId).Reorder({
    teamId,
    kind: "todo",
    ids: [...ids].reverse(),
    now: created,
  });
  const { query, parameters } = observed.statement();
  const plan = await c.binding
    .prepare(`EXPLAIN QUERY PLAN ${query}`)
    .bind(...parameters)
    .all<{ detail: string }>();
  const details = plan.results.map((row) => row.detail);
  expect(details.some((detail) => /MATERIALIZE requested/.test(detail))).toBe(true);
  expect(details.some((detail) => /SEARCH requested USING AUTOMATIC.*INDEX/.test(detail))).toBe(
    true,
  );
  expect((await c.repository.ListTodoItemsByTeamID(teamId)).map((item) => item.ID)).toEqual(
    [...ids].reverse(),
  );
  await expect(
    observed.repository.forMember(teamId, userId).Reorder({
      teamId,
      kind: "todo",
      ids: ids.map(() => ids[0]),
      now: created,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect((await c.repository.ListTodoItemsByTeamID(teamId)).map((item) => item.ID)).toEqual(
    [...ids].reverse(),
  );
});
