import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { unstable_splitSqlQuery } from "wrangler";
import { createTestDatabase } from "../helpers/d1";

it("removes stored TODO data while preserving teams, users and their remaining data", async () => {
  const connection = await createTestDatabase(undefined, "0013_user_preferences.sql");
  const { binding, db } = connection;
  const now = "2026-11-23T00:00:00.000Z";
  const expiry = "2026-12-01T00:00:00.000Z";
  try {
    const seed = [
      sql`INSERT INTO auth_user(id,name,email) VALUES('user','User','fixture@example.com')`,
      sql`INSERT INTO auth_session(id,token,user_id,expires_at) VALUES('session','fixture-token','user',${expiry})`,
      sql`INSERT INTO teams(id,name,created_at,todo_categories) VALUES('team','Team',${now},'[null,{"id":"category","name":"買い物"}]')`,
      sql`INSERT INTO team_members(team_id,user_id,role,created_at) VALUES('team','user','owner',${now})`,
      sql`INSERT INTO tasks(id,team_id,title,type,penalty_points,assignee_user_id,required_completions_per_week,sort_key,created_at,updated_at) VALUES('task','team','掃除','daily',1,'user',1,1,${now},${now})`,
      sql`INSERT INTO shared_pages(id,team_id,title,document_json,preview,created_at,updated_at,updated_by) VALUES('page','team','共有メモ','[]','',${now},${now},'user')`,
      sql`INSERT INTO todo_items(id,team_id,name,notes,category_id,sort_key,created_at,updated_at) VALUES('todo','team','牛乳','2本','category',1,${now},${now})`,
      sql`INSERT INTO user_preferences(user_id,todo_completion_delay_ms,default_todo_category) VALUES('user',5000,'{"kind":"category","id":"category"}')`,
      sql`INSERT INTO mcp_connections(id,user_id,client_id,client_name,resource,scopes,grant_id,created_at,expires_at) VALUES('connection','user','client','Fixture','https://fixture.example.com/mcp','["todos:read"]','grant',${now},${expiry})`,
      sql`INSERT INTO mcp_consent_claims(handle_hash,user_id,session_id,expires_at) VALUES('claim','user','session',${expiry})`,
      sql`UPDATE assist_usage SET total_count=10 WHERE id='voice'`,
    ];
    for (const statement of seed) await db.run(statement);

    await db.run(
      sql`INSERT INTO auth_user(id,name,email) VALUES('new-user','New User','new@example.com')`,
    );
    await connection.repository.ProvisionUser("new-user", "new-team", "New team", now);
    expect(await connection.repository.ListMembershipsByUserID("new-user")).toMatchObject([
      { TeamID: "new-team", Role: "owner" },
    ]);

    const retainedData = [
      "SELECT id, name, created_at FROM teams ORDER BY id",
      "SELECT * FROM auth_user ORDER BY id",
      "SELECT * FROM auth_session ORDER BY id",
      "SELECT * FROM team_members ORDER BY team_id, user_id",
      "SELECT * FROM tasks ORDER BY id",
      "SELECT * FROM shared_pages ORDER BY id",
    ];
    const snapshot = () =>
      Promise.all(retainedData.map(async (query) => (await binding.prepare(query).all()).results));
    const expected = await snapshot();
    const migration = await readFile(
      new URL("../../migrations/0014_remove_todos.sql", import.meta.url),
      "utf8",
    );
    await binding.batch(unstable_splitSqlQuery(migration).map((query) => binding.prepare(query)));

    expect(await snapshot()).toEqual(expected);
    expect((await binding.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    expect(
      (await binding.prepare("PRAGMA table_info(teams)").all()).results.map((row) => row.name),
    ).toEqual(["id", "name", "created_at"]);
    const retired = await binding
      .prepare(
        `SELECT name FROM sqlite_schema WHERE tbl_name IN
        ('todo_items', 'user_preferences', 'mcp_connections', 'mcp_consent_claims', 'assist_usage')`,
      )
      .all();
    expect(retired.results).toEqual([]);
  } finally {
    await connection.close();
  }
});
