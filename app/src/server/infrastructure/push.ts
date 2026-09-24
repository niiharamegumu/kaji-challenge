import { createHash } from "node:crypto";
import webPush from "web-push";
import { and, eq, lte, isNull, exists, sql } from "drizzle-orm";
import type { Database } from "./database";
import { pushDelivery, pushSubscriptions, teamMembers } from "./schema";
import type { DeliveryPort } from "../application/jobs";
const fingerprint = (sub: { Endpoint: string; P256dh: string; Auth: string }) =>
  createHash("sha256").update(`${sub.Endpoint}\n${sub.P256dh}\n${sub.Auth}`).digest("hex");
export function createDelivery(
  db: Database,
  vapid: { subject: string; publicKey: string; privateKey: string },
): DeliveryPort {
  return {
    async claim(sub, slot, date) {
      const claim = crypto.randomUUID();
      const now = new Date();
      const leaseUntil = new Date(now.getTime() + 300_000).toISOString();
      const result = await db
        .insert(pushDelivery)
        .select(
          db
            .select({
              subscription_id: sql<string>`${sub.ID}`.as("subscription_id"),
              slot: sql<string>`${slot}`.as("slot"),
              target_date: sql<string>`${date}`.as("target_date"),
              endpoint_hash: sql<string>`${fingerprint(sub)}`.as("endpoint_hash"),
              claim_id: sql<string>`${claim}`.as("claim_id"),
              lease_until: sql<string>`${leaseUntil}`.as("lease_until"),
              attempts: sql<number>`1`.as("attempts"),
              sent_at: sql<string | null>`NULL`.as("sent_at"),
            })
            .from(pushSubscriptions)
            .where(
              and(
                eq(pushSubscriptions.id, sub.ID),
                eq(pushSubscriptions.is_active, 1),
                eq(pushSubscriptions.team_id, sub.TeamID),
                eq(pushSubscriptions.user_id, sub.UserID),
                eq(pushSubscriptions.endpoint, sub.Endpoint),
                eq(pushSubscriptions.p256dh, sub.P256dh),
                eq(pushSubscriptions.auth, sub.Auth),
                exists(
                  db
                    .select({ id: teamMembers.user_id })
                    .from(teamMembers)
                    .where(
                      and(
                        eq(teamMembers.team_id, pushSubscriptions.team_id),
                        eq(teamMembers.user_id, pushSubscriptions.user_id),
                      ),
                    ),
                ),
              ),
            ),
        )
        .onConflictDoUpdate({
          target: [
            pushDelivery.subscription_id,
            pushDelivery.slot,
            pushDelivery.target_date,
            pushDelivery.endpoint_hash,
          ],
          set: {
            claim_id: claim,
            lease_until: leaseUntil,
            attempts: sql`${pushDelivery.attempts} + 1`,
          },
          setWhere: and(
            isNull(pushDelivery.sent_at),
            lte(pushDelivery.lease_until, now.toISOString()),
          ),
        })
        .returning({ claim: pushDelivery.claim_id });
      return result[0]?.claim ?? null;
    },
    async send(sub, payload) {
      const details = webPush.generateRequestDetails(
        { endpoint: sub.Endpoint, keys: { p256dh: sub.P256dh, auth: sub.Auth } },
        JSON.stringify(payload),
        { TTL: 3600, vapidDetails: vapid },
      );
      const response = await fetch(details.endpoint, {
        method: "POST",
        headers: details.headers,
        body: details.body ? new Uint8Array(details.body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      await response.body?.cancel();
      if ([404, 410].includes(response.status)) return "expired";
      if (!response.ok) throw new Error(`Push HTTP ${response.status}`);
      return "sent";
    },
    async finish(sub, slot, date, claim) {
      await db
        .update(pushDelivery)
        .set({ sent_at: new Date().toISOString() })
        .where(
          and(
            eq(pushDelivery.subscription_id, sub.ID),
            eq(pushDelivery.slot, slot),
            eq(pushDelivery.target_date, date),
            eq(pushDelivery.endpoint_hash, fingerprint(sub)),
            eq(pushDelivery.claim_id, claim),
          ),
        );
    },
  };
}
