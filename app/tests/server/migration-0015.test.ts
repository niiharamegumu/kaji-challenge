import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { unstable_splitSqlQuery } from "wrangler";
import { createTestDatabase } from "../helpers/d1";

it("drops stored pages, edit leases and creation receipts while retaining team membership", async () => {
  const { binding, close } = await createTestDatabase(undefined, "0014_remove_todos.sql");
  try {
    const now = "2026-11-24T00:00:00.000Z";
    await binding.batch([
      binding.prepare("INSERT INTO auth_user(id,name,email) VALUES('u','User','user@example.com')"),
      binding.prepare("INSERT INTO teams(id,name,created_at) VALUES('t','Team',?)").bind(now),
      binding
        .prepare(
          "INSERT INTO team_members(team_id,user_id,role,created_at) VALUES('t','u','owner',?)",
        )
        .bind(now),
      binding
        .prepare(`INSERT INTO shared_pages(id,team_id,title,document_json,preview,created_at,updated_at,updated_by,lease_user_id,lease_expires_at)
        VALUES('p','t','Title','{}','preview',?,?,'u','u',?)`)
        .bind(now, now, now),
      binding.prepare(
        "INSERT INTO shared_page_creations(team_id,user_id,request_id,page_id) VALUES('t','u','r','p')",
      ),
    ]);
    const migration = await readFile(
      new URL("../../migrations/0015_remove_shared_pages.sql", import.meta.url),
      "utf8",
    );
    await binding.batch(unstable_splitSqlQuery(migration).map((query) => binding.prepare(query)));
    expect(
      (
        await binding
          .prepare(
            "SELECT name FROM sqlite_schema WHERE tbl_name IN ('shared_pages','shared_page_creations')",
          )
          .all()
      ).results,
    ).toEqual([]);
    expect(
      await binding.prepare("SELECT team_id, user_id, role FROM team_members").first(),
    ).toEqual({
      team_id: "t",
      user_id: "u",
      role: "owner",
    });
    expect((await binding.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  } finally {
    await close();
  }
});
