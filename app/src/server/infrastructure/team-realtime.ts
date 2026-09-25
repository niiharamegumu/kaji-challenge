import { DurableObject } from "cloudflare:workers";
import { and, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "./database";
import { session } from "./auth-schema";
import { teamMembers } from "./schema";
import type { RealtimeMessage } from "../../contracts/realtime";

const connectionIdentitySchema = z.object({
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  teamId: z.string().min(1),
});
type ConnectionIdentity = z.infer<typeof connectionIdentitySchema>;
type Connection = { socket: WebSocket; identity: ConnectionIdentity };

// セッションIDに加えて有効期限のパラメーターも使うため、D1の上限100に余裕を持たせる。
const SESSION_QUERY_BATCH_SIZE = 90;

/** 業務データを保存せず、チームの接続と変更通知だけを扱う。 */
export class TeamRealtime extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    // この入口はWorkerの認証済みルートからbinding経由でのみ呼び出す。
    const identity = connectionIdentitySchema.safeParse({
      userId: request.headers.get("x-realtime-user"),
      sessionId: request.headers.get("x-realtime-session"),
      teamId: request.headers.get("x-realtime-team"),
    });
    if (!identity.success || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Invalid upgrade", { status: 400 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(identity.data);
    await this.broadcast(false);
    return new Response(null, { status: 101, webSocket: client });
  }

  async notify(): Promise<void> {
    await this.broadcast(true);
  }

  async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    // 受信専用の予約コードはcloseフレームに指定できない。
    const replyCode = [1005, 1006, 1015].includes(code) ? 1000 : code;
    socket.close(replyCode);
    await this.broadcast(false);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    socket.close(1011, "Connection unavailable");
    await this.broadcast(false);
  }

  webSocketMessage(socket: WebSocket): void {
    // 業務更新はServer Functionsに統一する。
    socket.close(1008, "Client messages are not supported");
  }

  /** 休止前のメモリーには依存せず、公式attachment APIから接続情報を復元する。 */
  private readConnections(): Connection[] {
    const connections: Connection[] = [];
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const identity = connectionIdentitySchema.safeParse(socket.deserializeAttachment());
      if (!identity.success) {
        socket.close(1008, "Invalid connection identity");
        continue;
      }
      connections.push({ socket, identity: identity.data });
    }
    return connections;
  }

  private async authorizeConnections(connections: Connection[]): Promise<Connection[]> {
    const db = createDb(this.env.DB);
    const sessionIds = [...new Set(connections.map(({ identity }) => identity.sessionId))];
    const activeSessions = new Map<string, { userId: string; teamId: string }>();

    for (let offset = 0; offset < sessionIds.length; offset += SESSION_QUERY_BATCH_SIZE) {
      const ids = sessionIds.slice(offset, offset + SESSION_QUERY_BATCH_SIZE);
      const rows = await db
        .select({ id: session.id, userId: session.userId, teamId: teamMembers.team_id })
        .from(session)
        .innerJoin(teamMembers, eq(teamMembers.user_id, session.userId))
        .where(and(inArray(session.id, ids), gt(session.expiresAt, new Date())));
      for (const row of rows) activeSessions.set(row.id, row);
    }

    return connections.filter(({ socket, identity }) => {
      const active = activeSessions.get(identity.sessionId);
      if (active?.userId !== identity.userId || active.teamId !== identity.teamId) {
        socket.close(1008, "Session or membership changed");
        return false;
      }
      return socket.readyState === WebSocket.OPEN;
    });
  }

  private async broadcast(dataChanged: boolean): Promise<void> {
    // D1への認証照会は外部I/O。照会中の入退室・別通知を直列化し、未検証の接続への
    // 配信や、古い接続一覧による上書きを防ぐ。業務更新を直列化するものではない。
    await this.ctx.blockConcurrencyWhile(async () => {
      try {
        const connections = await this.authorizeConnections(this.readConnections());
        const presence: RealtimeMessage = {
          type: "presence",
          userIds: [...new Set(connections.map(({ identity }) => identity.userId))].sort(),
        };
        const messages: RealtimeMessage[] = [presence];
        if (dataChanged) messages.push({ type: "team-changed" });
        const payloads = messages.map((message) => JSON.stringify(message));

        for (const { socket } of connections) {
          try {
            for (const payload of payloads) socket.send(payload);
          } catch {
            socket.close(1011, "Connection unavailable");
          }
        }
      } catch (error) {
        // blockConcurrencyWhile内で例外を捕捉し、DO全体のリセットを避ける。
        // 認可を確認できない間は配信せず、クライアントの再接続・再取得へ戻す。
        console.error(
          JSON.stringify({
            event: "team_broadcast_failed",
            errorName: error instanceof Error ? error.name : "UnknownError",
          }),
        );
        for (const socket of this.ctx.getWebSockets()) {
          socket.close(1011, "Connection unavailable");
        }
      }
    });
  }
}
