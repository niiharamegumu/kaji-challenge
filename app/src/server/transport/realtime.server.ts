import type { RuntimeBindings } from "./runtime.server";

export async function connectRealtime(
  request: Request,
  bindings: RuntimeBindings,
): Promise<Response> {
  if (bindings.MAINTENANCE_MODE === "true") return new Response("Maintenance", { status: 503 });
  if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
    return new Response("WebSocket required", { status: 426 });
  if (request.headers.get("Origin") !== new URL(bindings.APP_ORIGIN).origin)
    return new Response("Forbidden", { status: 403 });

  // クライアント指定のIDは使わず、Cookieのセッションと現在の所属から接続先を決める。
  const { createRuntime } = await import("./runtime.server");
  const runtime = createRuntime(bindings);
  const session = await runtime.auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const [member] = await runtime.repository.ListMembershipsByUserID(session.user.id);
  if (!member) return new Response("Forbidden", { status: 403 });

  const teamRealtime = bindings.TEAM_REALTIME.getByName(member.TeamID);
  return teamRealtime.fetch(
    new Request("https://realtime/connect", {
      headers: {
        Upgrade: "websocket",
        "x-realtime-user": session.user.id,
        "x-realtime-session": session.session.id,
        "x-realtime-team": member.TeamID,
      },
    }),
  );
}

/** 通知失敗を保存失敗にしない。次回接続・復帰時にも最新データを取得する。 */
export async function notifyTeams(bindings: RuntimeBindings, teamIds: string[]): Promise<void> {
  await Promise.all(
    [...new Set(teamIds)].map(async (teamId) => {
      try {
        await bindings.TEAM_REALTIME.getByName(teamId).notify();
      } catch {
        console.error(JSON.stringify({ event: "team_notification_failed", teamId }));
      }
    }),
  );
}
