import {
  McpPrincipalSchema,
  McpRequestSchema,
  McpTodoSchema,
  mcpScopes,
  requiredMcpScope,
  type McpData,
  type McpPrincipal,
  type McpRequest,
} from "../../contracts/mcp";
import { AppError } from "../domain/errors";
import { executeOperation } from "./operations";
import { todo } from "./mappers";
import type { McpConnection, McpRepository } from "./mcp-ports";
import type { Repository } from "./ports";

const allowedScopes = new Set<string>([...mcpScopes, "offline_access"]);
const unauthorized = () => new AppError(401, "unauthorized", "MCP連携の認証が失効しています。");
const forbidden = () => new AppError(403, "forbidden", "この操作を行う権限がありません。");

export async function authorizeMcpConnection(
  repository: McpRepository,
  principal: McpPrincipal,
): Promise<McpConnection> {
  const parsed = McpPrincipalSchema.safeParse(principal);
  if (!parsed.success || parsed.data.expiresAt <= Date.now() / 1000) throw unauthorized();
  const token = parsed.data;
  const connection = await repository.getConnection(token.connectionId);
  const now = Date.now();
  if (
    !connection ||
    token.expiresAt <= now / 1000 ||
    connection.userId !== token.userId ||
    connection.clientId !== token.clientId ||
    connection.resource !== token.resource ||
    !connection.grantId?.trim() ||
    connection.revokedAt !== null ||
    !(Date.parse(connection.expiresAt) > now)
  ) {
    throw unauthorized();
  }
  if (
    token.scopes.length === 0 ||
    !token.scopes.every((scope) => allowedScopes.has(scope) && connection.scopes.includes(scope))
  ) {
    throw forbidden();
  }
  return connection;
}

async function currentMembership(repository: Repository, userId: string) {
  const memberships = await repository.ListMembershipsByUserID(userId);
  const member = memberships[0];
  if (
    memberships.length !== 1 ||
    !member ||
    (member.Role !== "owner" && member.Role !== "member")
  ) {
    throw forbidden();
  }
  return member;
}

export async function executeMcpOperation(
  repository: Repository,
  mcpRepository: McpRepository,
  request: McpRequest,
  principal: McpPrincipal,
  context: { now: Date; vapidPublicKey: string },
): Promise<{ data: McpData; changedTeams: string[] }> {
  const parsed = McpRequestSchema.safeParse(request);
  if (!parsed.success) throw new AppError(400, "invalid_request", "入力内容を確認してください。");
  const input = parsed.data;
  await authorizeMcpConnection(mcpRepository, principal);
  if (!principal.scopes.includes(requiredMcpScope(input.tool))) throw forbidden();
  const member = await currentMembership(repository, principal.userId);
  const revalidate = async () => {
    await authorizeMcpConnection(mcpRepository, principal);
    const current = await currentMembership(repository, principal.userId);
    if (current.TeamID !== member.TeamID) throw forbidden();
  };

  try {
    if (input.tool === "list_todos") {
      const scoped = repository.forMember(member.TeamID, principal.userId);
      const items = (await scoped.ListTodoItemsByTeamID(member.TeamID)).map((item) =>
        McpTodoSchema.parse(todo(item)),
      );
      const categories = await scoped.ListTodoCategories(member.TeamID);
      // An empty SQL result must not turn a revoked grant or changed membership into success.
      await revalidate();
      return { data: { items, categories }, changedTeams: [] };
    }

    const result = await executeOperation(
      repository,
      input.tool === "add_todo"
        ? { operation: "postTodoItem", params: {}, body: input.arguments }
        : { operation: "deleteTodoItem", params: { itemId: input.arguments.itemId } },
      { userId: principal.userId, ...context },
    );
    await revalidate();
    return {
      data:
        input.tool === "add_todo"
          ? { item: McpTodoSchema.parse(result.data) }
          : { id: input.arguments.itemId, completed: true },
      changedTeams: result.changedTeams,
    };
  } catch (error) {
    // Prefer the current authorization error when a concurrent revoke prevented the SQL write.
    await revalidate();
    throw error;
  }
}
