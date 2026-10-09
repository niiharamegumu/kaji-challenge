import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type {
  McpConnection,
  McpConsentClaimInput,
  McpRepository,
  NewMcpConnection,
} from "../application/mcp-ports";
import { session, user } from "./auth-schema";
import type { Database } from "./database";
import { mcpConnections, mcpConsentClaims } from "./schema";

const connectionFields = {
  id: mcpConnections.id,
  userId: mcpConnections.user_id,
  clientId: mcpConnections.client_id,
  clientName: mcpConnections.client_name,
  resource: mcpConnections.resource,
  scopes: mcpConnections.scopes,
  grantId: mcpConnections.grant_id,
  createdAt: mcpConnections.created_at,
  expiresAt: mcpConnections.expires_at,
  revokedAt: mcpConnections.revoked_at,
};

export class D1McpRepository implements McpRepository {
  constructor(private readonly db: Database) {}

  async createConsentClaim(claim: McpConsentClaimInput): Promise<void> {
    await this.db.insert(mcpConsentClaims).values({
      handle_hash: claim.handleHash,
      user_id: claim.userId,
      session_id: claim.sessionId,
      expires_at: claim.expiresAt,
      consumed_at: null,
    });
  }

  async consumeConsentClaim(
    handleHash: string,
    userId: string,
    sessionId: string,
    now: string,
  ): Promise<boolean> {
    const consumed = await this.db
      .update(mcpConsentClaims)
      .set({ consumed_at: now })
      .where(
        and(
          eq(mcpConsentClaims.handle_hash, handleHash),
          eq(mcpConsentClaims.user_id, userId),
          eq(mcpConsentClaims.session_id, sessionId),
          gt(mcpConsentClaims.expires_at, now),
          isNull(mcpConsentClaims.consumed_at),
          sql`EXISTS (SELECT 1 FROM ${session}
            WHERE ${session.id} = ${sessionId}
              AND ${session.userId} = ${userId}
              AND ${session.expiresAt} > ${now})`,
        ),
      )
      .returning({ hash: mcpConsentClaims.handle_hash });
    return consumed.length === 1;
  }

  async createConnection(connection: NewMcpConnection): Promise<void> {
    await this.db.insert(mcpConnections).values({
      id: connection.id,
      user_id: connection.userId,
      client_id: connection.clientId,
      client_name: connection.clientName,
      resource: connection.resource,
      scopes: connection.scopes,
      created_at: connection.createdAt,
      expires_at: connection.expiresAt,
      grant_id: null,
      revoked_at: null,
    });
  }

  async bindGrant(
    connectionId: string,
    userId: string,
    clientId: string,
    resource: string,
    grantId: string,
    now: string,
  ): Promise<boolean> {
    const bound = await this.db
      .update(mcpConnections)
      .set({ grant_id: grantId })
      .where(
        and(
          eq(mcpConnections.id, connectionId),
          eq(mcpConnections.user_id, userId),
          eq(mcpConnections.client_id, clientId),
          eq(mcpConnections.resource, resource),
          isNull(mcpConnections.grant_id),
          isNull(mcpConnections.revoked_at),
          gt(mcpConnections.expires_at, now),
          sql`EXISTS (SELECT 1 FROM ${user} WHERE ${user.id} = ${userId})`,
        ),
      )
      .returning({ id: mcpConnections.id });
    return bound.length === 1;
  }

  async getConnection(id: string): Promise<McpConnection | null> {
    const [connection] = await this.db
      .select(connectionFields)
      .from(mcpConnections)
      .where(eq(mcpConnections.id, id));
    return connection ?? null;
  }

  async listConnections(userId: string): Promise<McpConnection[]> {
    return this.db
      .select(connectionFields)
      .from(mcpConnections)
      .where(eq(mcpConnections.user_id, userId))
      .orderBy(desc(mcpConnections.created_at), desc(mcpConnections.id));
  }

  async revokeConnection(id: string, userId: string, now: string): Promise<McpConnection | null> {
    const [connection] = await this.db
      .update(mcpConnections)
      .set({ revoked_at: sql`coalesce(${mcpConnections.revoked_at}, ${now})` })
      .where(and(eq(mcpConnections.id, id), eq(mcpConnections.user_id, userId)))
      .returning(connectionFields);
    return connection ?? null;
  }

  async revokeGrantConnection(
    userId: string,
    clientId: string,
    grantId: string,
    now: string,
  ): Promise<boolean> {
    const revoked = await this.db
      .update(mcpConnections)
      .set({ revoked_at: sql`coalesce(${mcpConnections.revoked_at}, ${now})` })
      .where(
        and(
          eq(mcpConnections.user_id, userId),
          eq(mcpConnections.client_id, clientId),
          eq(mcpConnections.grant_id, grantId),
        ),
      )
      .returning({ id: mcpConnections.id });
    return revoked.length === 1;
  }
}
