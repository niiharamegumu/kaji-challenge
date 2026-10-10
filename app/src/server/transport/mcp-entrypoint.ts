import { WorkerEntrypoint } from "cloudflare:workers";
import type { ValidatedAccessToken } from "@cloudflare/workers-oauth-provider";
import {
  McpPrincipalSchema,
  McpRequestSchema,
  McpTokenPropsSchema,
  mcpResponseSchemas,
  requiredMcpScope,
  type McpPrincipal,
  type McpRequest,
  type McpWireResult,
} from "../../contracts/mcp";
import { authorizeMcpConnection, executeMcpOperation } from "../application/mcp-operations";
import { AppError } from "../domain/errors";
import { createDatabase } from "../infrastructure/database";
import { D1McpRepository } from "../infrastructure/mcp-repository";
import { D1Repository } from "../infrastructure/repository";
import { createMcpAuthorizationServer } from "./mcp-oauth";
import { notifyChanges, type RuntimeBindings } from "./runtime.server";

/** This named entrypoint is a deployment-granted capability, never a public HTTP route. */
export class McpApplication extends WorkerEntrypoint<RuntimeBindings> {
  #resource() {
    if (this.env.MCP_ENABLED !== "true")
      throw new AppError(404, "not_found", "MCP連携は利用できません。");
    if (this.env.MAINTENANCE_MODE === "true")
      throw new AppError(503, "maintenance", "メンテナンス中です。");
    return `${new URL(this.env.MCP_ORIGIN).origin}/mcp`;
  }

  async validateToken(
    resource: string,
    token: string,
  ): Promise<ValidatedAccessToken<{ connectionId: string }> | null> {
    try {
      const expected = this.#resource();
      if (resource !== expected || typeof token !== "string" || !token || token.length > 16_384)
        return null;
      const verified = await createMcpAuthorizationServer(this.env).validateToken<{
        connectionId: string;
      }>(expected, token, this.env);
      if (!verified) return null;
      const props = McpTokenPropsSchema.safeParse(verified.props);
      const principal = McpPrincipalSchema.safeParse({
        userId: verified.userId,
        clientId: verified.clientId,
        resource: verified.audience,
        scopes: verified.scope,
        expiresAt: verified.expiresAt,
        connectionId: props.success ? props.data.connectionId : undefined,
      });
      if (!principal.success || principal.data.resource !== expected) return null;
      const { db, repository } = createDatabase(this.env.DB);
      await authorizeMcpConnection(new D1McpRepository(db), principal.data);
      const memberships = await repository.ListMembershipsByUserID(principal.data.userId);
      if (memberships.length !== 1 || !["owner", "member"].includes(memberships[0].Role))
        return null;
      return verified;
    } catch (error) {
      if (error instanceof AppError && error.status < 500) return null;
      // RPC serialization and runtime logs must not disclose provider/SQL exception details.
      throw new Error("MCP authorization is unavailable.");
    }
  }

  async invoke(principal: McpPrincipal, request: McpRequest): Promise<McpWireResult> {
    try {
      const resource = this.#resource();
      const caller = McpPrincipalSchema.safeParse(principal);
      const input = McpRequestSchema.safeParse(request);
      if (!caller.success || caller.data.resource !== resource)
        throw new AppError(401, "unauthorized", "MCP連携の認証を確認できません。");
      if (!input.success)
        throw new AppError(400, "invalid_request", "入力内容を確認してください。");
      const now = new Date();
      const { db } = createDatabase(this.env.DB);
      const repository = new D1Repository(db, undefined, {
        connectionId: caller.data.connectionId,
        userId: caller.data.userId,
        scope: requiredMcpScope(input.data.tool),
        tokenExpiresAt: new Date(caller.data.expiresAt * 1000).toISOString(),
      });
      const result = await executeMcpOperation(
        repository,
        new D1McpRepository(db),
        input.data,
        caller.data,
        { now, vapidPublicKey: this.env.VAPID_PUBLIC_KEY },
      );
      const data = mcpResponseSchemas[input.data.tool].parse(result.data);
      if (result.changedTeams.length) notifyChanges(this.env, result.changedTeams, ["todos"]);
      return { ok: true, data };
    } catch (error) {
      if (error instanceof AppError)
        return {
          ok: false,
          error: { status: error.status, code: error.code, message: error.message },
        };
      return {
        ok: false,
        error: {
          status: 503,
          code: "unavailable",
          message: "処理結果を確認できません。一覧を再取得して確認してください。",
        },
      };
    }
  }
}
