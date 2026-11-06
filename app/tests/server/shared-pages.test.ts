import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase } from "../helpers/d1";
import { provisionUser } from "../../src/server/application/provision-user";
import { executeOperation } from "../../src/server/application/operations";
import { operationSchema, responseSchemas } from "../../src/contracts/operations";
import {
  SharedPageDocumentSchema,
  SharedPageSchema,
  SharedPageLeaseResponseSchema,
  type SharedPageDocument,
} from "../../src/contracts/shared-pages";

const document = (checked = false): SharedPageDocument => ({
  format: "blocknote",
  schemaVersion: 1,
  blocks: [
    {
      id: "heading",
      type: "heading",
      props: { level: 2 },
      content: [{ type: "text", text: "旅行の計画", styles: { bold: true } }],
      children: [],
    },
    {
      id: "check",
      type: "checkListItem",
      props: { checked },
      content: [{ type: "text", text: "宿を予約する", styles: {} }],
      children: [],
    },
    {
      id: "link",
      type: "paragraph",
      props: {},
      content: [
        {
          type: "link",
          href: "https://example.com/trip",
          content: [{ type: "text", text: "行きたい場所", styles: {} }],
        },
      ],
      children: [],
    },
  ],
});

describe("shared page document contract", () => {
  it("returns a validation error for cyclic and non-JSON values from RPC deserialization", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const value of [cycle, 1n]) {
      const input = document();
      Object.assign(input.blocks[0].props, { unknown: value });
      expect(SharedPageDocumentSchema.safeParse(input).success).toBe(false);
      expect(
        operationSchema.safeParse({
          operation: "postSharedPage",
          body: { title: "bad", document: input },
        }).success,
      ).toBe(false);
    }
  });
  it("roundtrips basic blocks, text styles, links and independent checkboxes losslessly", () => {
    expect(SharedPageDocumentSchema.parse(document(true))).toEqual(document(true));
  });
  it.each([
    { format: "markdown", schemaVersion: 1, blocks: [] },
    { ...document(), schemaVersion: 2 },
    { ...document(), blocks: [{ ...document().blocks[0], type: "image" }] },
    {
      ...document(),
      blocks: [
        {
          ...document().blocks[2],
          content: [{ type: "link", href: "javascript:alert(1)", content: [] }],
        },
      ],
    },
    {
      ...document(),
      blocks: [
        {
          ...document().blocks[0],
          content: [{ type: "text", text: "a".repeat(100_001), styles: {} }],
        },
      ],
    },
    {
      ...document(),
      blocks: Array.from({ length: 1001 }, (_, i) => ({ ...document().blocks[0], id: `${i}` })),
    },
    { ...document(), blocks: [document().blocks[0], document().blocks[0]] },
    { ...document(), blocks: [{ ...document().blocks[0], props: { unexpected: true } }] },
  ])("rejects unsupported or unsafe document input %#", (value) => {
    expect(SharedPageDocumentSchema.safeParse(value).success).toBe(false);
  });
  it("rejects overdeep trees and overlarge UTF-8 data before recursive schema parsing", () => {
    const deep = document();
    let cursor = deep.blocks[0];
    for (let i = 0; i < 20; i++) {
      const child = { ...document().blocks[0], id: `deep-${i}` };
      cursor.children = [child];
      cursor = child;
    }
    expect(SharedPageDocumentSchema.safeParse(deep).success).toBe(false);
    const large = document();
    large.blocks[0].content = [{ type: "text", text: "あ".repeat(90_000), styles: {} }];
    expect(SharedPageDocumentSchema.safeParse(large).success).toBe(false);
  });
  it("rejects client identities and lease ownership spoofing in all public input shapes", () => {
    expect(
      operationSchema.safeParse({
        operation: "postSharedPage",
        body: { title: "旅", document: document(), teamId: "foreign" },
      }).success,
    ).toBe(false);
    expect(
      operationSchema.safeParse({
        operation: "postSharedPageLease",
        params: { pageId: crypto.randomUUID() },
        body: { userId: "other", expiresAt: "2099-01-01T00:00:00.000Z" },
      }).success,
    ).toBe(false);
    expect(
      operationSchema.safeParse({
        operation: "getSharedPage",
        params: { pageId: crypto.randomUUID(), teamId: "foreign" },
      }).success,
    ).toBe(false);
  });
  it.each(["postSharedPageLease", "renewSharedPageLease", "releaseSharedPageLease"])(
    "%s accepts only the page ID and rejects client-provided ownership",
    (operation) => {
      const request = { operation, params: { pageId: crypto.randomUUID() } };
      expect(operationSchema.safeParse(request).success).toBe(true);
      for (const body of [
        {},
        { userId: "other" },
        { token: crypto.randomUUID() },
        { tabId: crypto.randomUUID() },
      ]) {
        expect(operationSchema.safeParse({ ...request, body }).success).toBe(false);
      }
    },
  );
});

describe("shared pages persisted in D1 with expiring editor ownership", () => {
  let c: Awaited<ReturnType<typeof createTestDatabase>>;
  const owner = crypto.randomUUID();
  const member = crypto.randomUUID();
  const outsider = crypto.randomUUID();
  const sessions = new Map<string, string>(
    [owner, member, outsider].map((id) => [id, crypto.randomUUID()]),
  );
  const ownerOtherDevice = crypto.randomUUID();
  let teamId: string;
  let otherTeamId: string;
  const repo = (userId = owner, sessionId = sessions.get(userId)!) =>
    c.repository.forSession(userId, sessionId);
  const run = async (
    operation: string,
    body?: unknown,
    params = {},
    userId = owner,
    sessionId = sessions.get(userId)!,
  ) => {
    const input = operationSchema.parse({
      operation,
      ...(body === undefined ? {} : { body }),
      params,
    });
    const result = await executeOperation(repo(userId, sessionId), input, {
      userId,
      now: new Date(),
      vapidPublicKey: "",
    });
    return {
      data: responseSchemas[input.operation].parse(result.data),
      changedTeams: result.changedTeams,
    };
  };
  const create = async (userId = owner) =>
    SharedPageSchema.parse(
      (await run("postSharedPage", { title: "京都旅行", document: document() }, {}, userId)).data,
    );
  const acquire = async (id: string, userId = owner, sessionId = sessions.get(userId)!) =>
    SharedPageLeaseResponseSchema.parse(
      (await run("postSharedPageLease", undefined, { pageId: id }, userId, sessionId)).data,
    );
  const snapshot = async () => (await c.query(sql`SELECT * FROM shared_pages ORDER BY id`)).rows;
  const restoreMember = () =>
    c.query(sql`INSERT INTO team_members(team_id,user_id,role,created_at)
    VALUES (${teamId},${member},'member',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(user_id) DO UPDATE SET team_id=excluded.team_id`);
  const restoreSession = (id: string, sessionId = sessions.get(id)!) =>
    c.query(sql`
    INSERT INTO auth_session(id,token,user_id,expires_at) VALUES (${sessionId},${sessionId},${id},'2099-01-01T00:00:00.000Z')
    ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at`);

  beforeAll(async () => {
    c = await createTestDatabase();
    for (const id of [owner, member, outsider]) {
      await c.query(
        sql`INSERT INTO auth_user(id,name,email) VALUES (${id},${id === owner ? "あおい" : "ゆう"},${id + "@example.com"})`,
      );
      await restoreSession(id);
    }
    await restoreSession(owner, ownerOtherDevice);
    for (const id of [owner, outsider]) await provisionUser(c.repository, id, new Date());
    teamId = (await c.repository.ListMembershipsByUserID(owner))[0].TeamID;
    otherTeamId = (await c.repository.ListMembershipsByUserID(outsider))[0].TeamID;
    await restoreMember();
  });
  afterAll(async () => {
    await c?.close();
  });

  it("creates, lists, reads, saves checkbox changes, restores through a new session and deletes", async () => {
    const page = await create(member);
    expect(page).toMatchObject({
      title: "京都旅行",
      document: document(),
      version: 0,
      editing: null,
    });
    const list = (await run("listSharedPages", undefined, {}, owner)).data;
    expect(list).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: page.id, preview: "旅行の計画 宿を予約する 行きたい場所" }),
      ]),
    });
    const edit = await acquire(page.id, member);
    expect(edit.page.editing).toMatchObject({ userId: member });
    expect(Date.parse(edit.lease.expiresAt) - Date.parse(edit.lease.serverNow)).toBe(90_000);
    const saved = SharedPageSchema.parse(
      (
        await run(
          "patchSharedPage",
          {
            title: "秋の京都旅行",
            document: document(true),
            expectedVersion: 0,
          },
          { pageId: page.id },
          member,
        )
      ).data,
    );
    expect(saved.version).toBe(1);
    expect(saved.document).toEqual(document(true));
    await run("releaseSharedPageLease", undefined, { pageId: page.id }, member);
    expect(
      (await run("getSharedPage", undefined, { pageId: page.id }, owner, ownerOtherDevice)).data,
    ).toMatchObject({ title: "秋の京都旅行", document: document(true), editing: null });
    await acquire(page.id);
    await run("deleteSharedPage", { expectedVersion: 1 }, { pageId: page.id });
    await expect(run("getSharedPage", undefined, { pageId: page.id })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("reading does not acquire ownership and lease data contains only its expiry and server time", async () => {
    const page = await create();
    await run("getSharedPage", undefined, { pageId: page.id }, member);
    expect(
      (
        await c.query(
          sql`SELECT lease_user_id,lease_expires_at FROM shared_pages WHERE id=${page.id}`,
        )
      ).rows[0],
    ).toEqual({ lease_user_id: null, lease_expires_at: null });
    const held = await acquire(page.id);
    expect(Object.keys(held.lease).sort()).toEqual(["expiresAt", "serverNow"]);
    const result = await run("getSharedPage", undefined, { pageId: page.id }, member);
    expect(result.data).toMatchObject({
      editing: { userId: owner, displayName: "あおい" },
      document: document(),
    });
    for (const secret of [sessions.get(owner)!, "lease_token", "lease_session_id", "lease_tab_id"])
      expect(JSON.stringify(result.data)).not.toContain(secret);
  });

  it("only one of simultaneous different users acquires ownership", async () => {
    const page = await create();
    const results = await Promise.allSettled([owner, member].map((id) => acquire(page.id, id)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((r) => r.status === "rejected");
    expect(failure?.status === "rejected" ? failure.reason : undefined).toMatchObject({
      status: 409,
      code: "page_locked",
    });
  });

  it("allows the owning user to acquire from simultaneous tabs and use another valid login session", async () => {
    const page = await create();
    const results = await Promise.all([
      acquire(page.id),
      acquire(page.id, owner, ownerOtherDevice),
    ]);
    expect(results.every((result) => result.page.editing?.userId === owner)).toBe(true);
    await expect(
      run("renewSharedPageLease", undefined, { pageId: page.id }, owner, ownerOtherDevice),
    ).resolves.toMatchObject({
      data: { expiresAt: expect.any(String), serverNow: expect.any(String) },
    });
    await expect(
      run(
        "patchSharedPage",
        { title: "別端末から保存", document: document(true), expectedVersion: 0 },
        { pageId: page.id },
        owner,
        ownerOtherDevice,
      ),
    ).resolves.toMatchObject({ data: { version: 1, title: "別端末から保存" } });
    await run("releaseSharedPageLease", undefined, { pageId: page.id }, owner, ownerOtherDevice);
    expect((await run("getSharedPage", undefined, { pageId: page.id })).data).toMatchObject({
      editing: null,
    });
    await acquire(page.id);
    await run(
      "deleteSharedPage",
      { expectedVersion: 1 },
      { pageId: page.id },
      owner,
      ownerOtherDevice,
    );
    await expect(run("getSharedPage", undefined, { pageId: page.id })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("hands expired leases over and rejects delayed old saves, renewals, releases and deletes", async () => {
    const page = await create();
    await acquire(page.id);
    await c.query(
      sql`UPDATE shared_pages SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE id=${page.id}`,
    );
    const next = await acquire(page.id, member);
    expect(next.page.editing?.userId).toBe(member);
    await run(
      "patchSharedPage",
      {
        title: "new session",
        document: document(true),
        expectedVersion: 0,
      },
      { pageId: page.id },
      member,
    );
    const before = await snapshot();
    for (const operation of [
      "renewSharedPageLease",
      "releaseSharedPageLease",
      "patchSharedPage",
      "deleteSharedPage",
    ]) {
      const body =
        operation === "patchSharedPage"
          ? { title: "stale", document: document(), expectedVersion: 1 }
          : operation === "deleteSharedPage"
            ? { expectedVersion: 1 }
            : undefined;
      await expect(run(operation, body, { pageId: page.id })).rejects.toMatchObject({
        status: 409,
        code: "edit_lease_lost",
      });
    }
    expect(await snapshot()).toEqual(before);
    await expect(
      run("renewSharedPageLease", undefined, { pageId: page.id }, member),
    ).resolves.toMatchObject({
      data: { expiresAt: expect.any(String), serverNow: expect.any(String) },
    });
  });

  it("uses the D1 clock for natural expiry and refuses resurrection by a late heartbeat", async () => {
    const page = await create();
    await acquire(page.id);
    await c.query(
      sql`UPDATE shared_pages SET lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+0.1 seconds') WHERE id=${page.id}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    await expect(run("renewSharedPageLease", undefined, { pageId: page.id })).rejects.toMatchObject(
      { code: "edit_lease_lost" },
    );
    await expect(
      run(
        "patchSharedPage",
        { title: "late", document: document(), expectedVersion: 0 },
        { pageId: page.id },
      ),
    ).rejects.toMatchObject({ code: "edit_lease_lost" });
    await expect(
      run("releaseSharedPageLease", undefined, { pageId: page.id }),
    ).rejects.toMatchObject({ code: "edit_lease_lost" });
    await expect(
      run("deleteSharedPage", { expectedVersion: 0 }, { pageId: page.id }),
    ).rejects.toMatchObject({ code: "edit_lease_lost" });
    await expect(acquire(page.id, member)).resolves.toMatchObject({
      page: { title: "京都旅行", version: 0 },
    });
  });

  it("prevents concurrent and delayed saves across the same user's sessions from overwriting a newer version", async () => {
    const page = await create();
    await acquire(page.id);
    const save = (title: string, sessionId = sessions.get(owner)!) =>
      run(
        "patchSharedPage",
        { title, document: document(), expectedVersion: 0 },
        { pageId: page.id },
        owner,
        sessionId,
      );
    const results = await Promise.allSettled([save("first"), save("second", ownerOtherDevice)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : undefined).toMatchObject({
      status: 409,
      code: "page_version_conflict",
    });
    const before = await snapshot();
    await expect(save("late retry")).rejects.toMatchObject({ code: "page_version_conflict" });
    expect(await snapshot()).toEqual(before);
  });

  it("refetches the latest saved document atomically when acquiring after an old read", async () => {
    const page = await create();
    await run("getSharedPage", undefined, { pageId: page.id }, member);
    await acquire(page.id);
    await run(
      "patchSharedPage",
      { title: "latest", document: document(true), expectedVersion: 0 },
      { pageId: page.id },
    );
    await run("releaseSharedPageLease", undefined, { pageId: page.id });
    expect((await acquire(page.id, member)).page).toMatchObject({
      title: "latest",
      document: document(true),
      version: 1,
    });
  });

  it("denies foreign IDs across read/update/delete/acquire/renew/release and excludes them from lists", async () => {
    const foreign = await create(outsider);
    await acquire(foreign.id, outsider);
    const before = await snapshot();
    const attempts = [
      ["getSharedPage", undefined],
      ["postSharedPageLease", undefined],
      ["renewSharedPageLease", undefined],
      ["releaseSharedPageLease", undefined],
      ["patchSharedPage", { title: "foreign", document: document(true), expectedVersion: 0 }],
      ["deleteSharedPage", { expectedVersion: 0 }],
    ] as const;
    for (const [operation, body] of attempts)
      await expect(run(operation, body, { pageId: foreign.id })).rejects.toMatchObject({
        status: 404,
      });
    expect(JSON.stringify((await run("listSharedPages")).data)).not.toContain(foreign.id);
    await expect(
      repo().forMember(teamId, owner).CreateSharedPage({
        id: crypto.randomUUID(),
        teamId: otherTeamId,
        userId: owner,
        title: "bad",
        document: document(),
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await snapshot()).toEqual(before);
  });

  it.each(["moved", "removed", "revoked", "expired"] as const)(
    "rechecks %s access in SQL after creating a scoped repository",
    async (mode) => {
      await restoreMember();
      await restoreSession(member);
      const page = await create();
      await acquire(page.id, member);
      const scoped = repo(member).forMember(teamId, member);
      if (mode === "moved")
        await c.query(sql`UPDATE team_members SET team_id=${otherTeamId} WHERE user_id=${member}`);
      if (mode === "removed") await c.query(sql`DELETE FROM team_members WHERE user_id=${member}`);
      if (mode === "revoked")
        await c.query(sql`DELETE FROM auth_session WHERE id=${sessions.get(member)!}`);
      if (mode === "expired")
        await c.query(
          sql`UPDATE auth_session SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=${sessions.get(member)!}`,
        );
      const before = await snapshot();
      try {
        expect(await scoped.ListSharedPages(teamId)).toEqual([]);
        await expect(scoped.GetSharedPage(page.id)).rejects.toMatchObject({ status: 404 });
        const code = mode === "moved" || mode === "removed" ? 403 : 401;
        await expect(
          scoped.CreateSharedPage({
            id: crypto.randomUUID(),
            teamId,
            userId: member,
            title: "bad",
            document: document(),
          }),
        ).rejects.toMatchObject({ status: code });
        await expect(scoped.AcquireSharedPageLease(page.id)).rejects.toMatchObject({
          status: code,
        });
        await expect(scoped.RenewSharedPageLease(page.id)).rejects.toMatchObject({
          status: code,
        });
        await expect(scoped.ReleaseSharedPageLease(page.id)).rejects.toMatchObject({
          status: code,
        });
        await expect(
          scoped.UpdateSharedPage({
            id: page.id,
            userId: member,
            title: "bad",
            document: document(true),
            expectedVersion: 0,
          }),
        ).rejects.toMatchObject({ status: code });
        await expect(scoped.DeleteSharedPage(page.id, 0)).rejects.toMatchObject({
          status: code,
        });
        expect(await snapshot()).toEqual(before);
      } finally {
        await restoreMember();
        await restoreSession(member);
      }
    },
  );

  it("keeps user ownership after one login session is revoked and rejects only that revoked caller", async () => {
    const page = await create();
    await acquire(page.id);
    await c.query(sql`DELETE FROM auth_session WHERE id=${sessions.get(owner)!}`);
    try {
      await expect(acquire(page.id, member)).rejects.toMatchObject({ code: "page_locked" });
      await expect(
        run("renewSharedPageLease", undefined, { pageId: page.id }),
      ).rejects.toMatchObject({ status: 401 });
      expect((await acquire(page.id, owner, ownerOtherDevice)).page).toMatchObject({
        title: "京都旅行",
        document: document(),
        version: 0,
        editing: { userId: owner },
      });
    } finally {
      await restoreSession(owner);
    }
  });

  it("allows takeover when the previous editor leaves the team before expiry", async () => {
    const page = await create();
    await acquire(page.id, member);
    await c.query(sql`DELETE FROM team_members WHERE user_id=${member}`);
    try {
      expect((await run("getSharedPage", undefined, { pageId: page.id })).data).toMatchObject({
        editing: null,
      });
      expect((await acquire(page.id)).page).toMatchObject({
        editing: { userId: owner },
        version: 0,
      });
    } finally {
      await restoreMember();
    }
  });

  it("page operations and checklist changes do not mutate chores, ToDos, scores or month-close state", async () => {
    const business = async () => {
      const tables = [
        "tasks",
        "todo_items",
        "task_completion_daily",
        "task_completion_weekly_entries",
        "penalty_rules",
        "monthly_penalty_summaries",
        "monthly_penalty_summary_triggered_rules",
        "close_runs",
      ];
      return Promise.all(
        tables.map((table) => c.query(sql`SELECT * FROM ${sql.identifier(table)}`)),
      );
    };
    await run("postTodoItem", { name: "既存の買い物" });
    const daily = responseSchemas.postTask.parse(
      (await run("postTask", { title: "毎日の家事", type: "daily", penaltyPoints: 3 })).data,
    );
    const weekly = responseSchemas.postTask.parse(
      (await run("postTask", { title: "週の家事", type: "weekly", penaltyPoints: 4 })).data,
    );
    const rule = responseSchemas.postPenaltyRule.parse(
      (await run("postPenaltyRule", { name: "既存ペナルティ", threshold: 1 })).data,
    );
    await c.query(sql`INSERT INTO task_completion_daily(task_id,target_date,completed_by_user_id,created_at)
      VALUES (${daily.id},'2026-11-01',${owner},'2026-11-01T00:00:00.000Z')`);
    await c.query(sql`INSERT INTO task_completion_weekly_entries(id,task_id,week_start,completed_by_user_id,created_at)
      VALUES (${crypto.randomUUID()},${weekly.id},'2026-11-02',${owner},'2026-11-02T00:00:00.000Z')`);
    await c.query(sql`INSERT INTO monthly_penalty_summaries(team_id,month_start,daily_penalty_total,weekly_penalty_total,is_closed)
      VALUES (${teamId},'2026-10-01',3,4,1)`);
    await c.query(sql`INSERT INTO monthly_penalty_summary_triggered_rules(team_id,month_start,rule_id,created_at)
      VALUES (${teamId},'2026-10-01',${rule.id},'2026-10-31T15:00:00.000Z')`);
    await c.query(sql`INSERT INTO close_runs(team_id,scope,target_date,created_at)
      VALUES (${teamId},'close_day','2026-10-31','2026-10-31T15:00:00.000Z')`);
    const before = await business();
    expect(before.every((table) => table.rows.length > 0)).toBe(true);
    const page = await create();
    await acquire(page.id);
    const saved = await run(
      "patchSharedPage",
      {
        title: "チェック済み",
        document: document(true),
        expectedVersion: 0,
      },
      { pageId: page.id },
    );
    expect(saved.changedTeams).toEqual([teamId]);
    await run("deleteSharedPage", { expectedVersion: 1 }, { pageId: page.id });
    expect(await business()).toEqual(before);
  });
});
