import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createECDH, randomBytes } from "node:crypto";
import webPush from "web-push";
import { sql } from "drizzle-orm";
import { createTestDatabase } from "../helpers/d1";
import { createDelivery } from "../../src/server/infrastructure/push";
import { notifyOutstanding } from "../../src/server/application/jobs";
describe("push delivery ledger", () => {
  let c: Awaited<ReturnType<typeof createTestDatabase>>;
  const userId = crypto.randomUUID(),
    teamId = crypto.randomUUID(),
    subId = crypto.randomUUID();
  const peer = createECDH("prime256v1");
  peer.generateKeys();
  let sub: Awaited<ReturnType<typeof c.repository.ListActivePushSubscriptionsByTeamID>>[number];
  beforeAll(async () => {
    c = await createTestDatabase();
    await c.query(
      sql`INSERT INTO auth_user(id,name,email) VALUES(${userId},'Push',${userId + "@example.com"})`,
    );
    await c.query(
      sql`INSERT INTO teams(id,name,created_at) VALUES (${teamId},'Push fixture',strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    );
    await c.query(
      sql`INSERT INTO team_members(team_id,user_id,role,created_at) VALUES (${teamId},${userId},'owner',strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    );
    await c.repository.UpsertPushSubscription({
      ID: subId,
      TeamID: teamId,
      UserID: userId,
      Endpoint: "https://web.push.apple.com/Q-test-only",
      P256dh: Buffer.from(peer.getPublicKey()).toString("base64url"),
      Auth: Buffer.from(randomBytes(16)).toString("base64url"),
      UserAgent: "test",
      Platform: "ios_safari_pwa",
      LastSeenAt: new Date().toISOString(),
      CreatedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString(),
    });
    sub = (await c.repository.ListActivePushSubscriptionsByTeamID(teamId))[0];
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    if (c) {
      await c.query(sql`DELETE FROM teams WHERE id=${teamId}`);
      await c.close();
    }
  });
  it("claims once, encrypts, marks success and never resends a successful subscription", async () => {
    const vapid = webPush.generateVAPIDKeys(),
      delivery = createDelivery(c.db, { subject: "mailto:test@example.com", ...vapid });
    const claim = await delivery.claim(sub, "daily_2100", "2026-09-14");
    expect(claim).toBeTruthy();
    expect(await delivery.claim(sub, "daily_2100", "2026-09-14")).toBeNull();
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    expect(
      await delivery.send(sub, {
        title: "通知",
        body: "掃除",
        tag: "team:test:daily_2100:2026-09-14",
        url: "/",
        teamId,
        slotKind: "daily_2100",
      }),
    ).toBe("sent");
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      redirect: "error",
      body: expect.any(Uint8Array),
    });
    await delivery.finish(sub, "daily_2100", "2026-09-14", claim!);
    expect(await delivery.claim(sub, "daily_2100", "2026-09-14")).toBeNull();
    const stored = await c.binding
      .prepare(
        "SELECT lease_until,sent_at FROM push_delivery WHERE subscription_id=? AND target_date='2026-09-14'",
      )
      .bind(subId)
      .first();
    expect(stored).toMatchObject({
      lease_until: expect.stringMatching(/^\d{4}-.*\.\d{3}Z$/),
      sent_at: expect.stringMatching(/^\d{4}-.*\.\d{3}Z$/),
    });
    vi.unstubAllGlobals();
  });
  it("allows a failed lease to resume and rejects stale completion claims", async () => {
    const delivery = createDelivery(c.db, {
      subject: "mailto:test@example.com",
      ...webPush.generateVAPIDKeys(),
    });
    const first = await delivery.claim(sub, "daily_2100", "2026-09-15");
    await c.query(
      sql`UPDATE push_delivery SET lease_until=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 second') WHERE subscription_id=${subId} AND target_date='2026-09-15'`,
    );
    const second = await delivery.claim(sub, "daily_2100", "2026-09-15");
    expect(second).not.toBe(first);
    await delivery.finish(sub, "daily_2100", "2026-09-15", first!);
    const result = await c.query(
      sql`SELECT sent_at FROM push_delivery WHERE subscription_id=${subId} AND target_date='2026-09-15'`,
    );
    expect(result.rows[0].sent_at).toBeNull();
  });
  it("rejects a departed member even when a previously loaded subscription is still active", async () => {
    const delivery = createDelivery(c.db, {
      subject: "mailto:test@example.com",
      ...webPush.generateVAPIDKeys(),
    });
    await c.query(sql`DELETE FROM team_members WHERE team_id=${teamId} AND user_id=${userId}`);
    try {
      expect(await c.repository.ListActivePushSubscriptionsByTeamID(teamId)).toHaveLength(0);
      expect(await c.repository.ListTeamIDsForPush()).not.toContain(teamId);
      expect(await delivery.claim(sub, "daily_2100", "2026-09-17")).toBeNull();
    } finally {
      await c.query(
        sql`INSERT INTO team_members(team_id,user_id,role,created_at) VALUES (${teamId},${userId},'owner',strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      );
    }
  });
  function registration(owner: string, team: string) {
    return {
      ID: crypto.randomUUID(),
      TeamID: team,
      UserID: owner,
      Endpoint: sub.Endpoint,
      P256dh: sub.P256dh,
      Auth: sub.Auth,
      UserAgent: "test",
      Platform: "ios_safari_pwa",
      LastSeenAt: new Date().toISOString(),
      CreatedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString(),
    };
  }
  it("rolls back removal of the old subscription if registration in the new team fails", async () => {
    await expect(
      c.repository.UpsertPushSubscription(registration(userId, crypto.randomUUID())),
    ).rejects.toThrow("FOREIGN KEY constraint failed");
    expect(await c.repository.ListActivePushSubscriptionsByTeamID(teamId)).toEqual([
      expect.objectContaining({ ID: subId }),
    ]);
  });
  it("cannot take an endpoint registered by another user", async () => {
    const other = crypto.randomUUID();
    await c.query(
      sql`INSERT INTO auth_user(id,name,email) VALUES(${other},'Other',${other + "@example.com"})`,
    );
    try {
      await expect(
        c.repository.UpsertPushSubscription(registration(other, teamId)),
      ).rejects.toThrow("UNIQUE constraint failed");
      expect(await c.repository.ListActivePushSubscriptionsByTeamID(teamId)).toEqual([
        expect.objectContaining({ ID: subId, UserID: userId }),
      ]);
    } finally {
      await c.query(sql`DELETE FROM auth_user WHERE id=${other}`);
    }
  });
  it("deactivates expired subscriptions while retaining the existing tag", async () => {
    const now = new Date();
    await c.repository.CreateTask({
      ID: crypto.randomUUID(),
      TeamID: teamId,
      Title: "掃除",
      Notes: null,
      Type: "daily",
      PenaltyPoints: 1,
      AssigneeUserID: "",
      RequiredCompletionsPerWeek: 1,
      SortKey: 100,
      CreatedAt: new Date(now.getTime() - 1000).toISOString(),
      UpdatedAt: now.toISOString(),
    });
    const send = vi.fn().mockResolvedValue("expired");
    await notifyOutstanding(
      c.repository,
      { claim: async () => crypto.randomUUID(), send, finish: async () => {} },
      "daily_2100",
      now,
    );
    expect(send.mock.calls[0][1].tag).toMatch(new RegExp(`^team:${teamId}:daily_2100:`));
    expect(await c.repository.ListActivePushSubscriptionsByTeamID(teamId)).toHaveLength(0);
  });
});
