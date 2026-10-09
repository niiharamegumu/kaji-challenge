import { z } from "zod";
import {
  CreateTodoItemRequestSchema,
  TodoItemSchema,
  TodoCategoriesResponseSchema,
} from "./operations";

export const mcpScopes = ["todos:read", "todos:write"] as const;
export const McpScopeSchema = z.enum(mcpScopes);
export const McpTokenPropsSchema = z.strictObject({ connectionId: z.uuid() });
export const McpPrincipalSchema = z.strictObject({
  userId: z.string().min(1).max(200),
  connectionId: z.uuid(),
  clientId: z.string().min(1).max(2048),
  resource: z.url(),
  scopes: z.array(z.string().max(100)).max(10),
  expiresAt: z.number().finite().positive(),
});
export type McpPrincipal = z.infer<typeof McpPrincipalSchema>;
export const ListTodosInputSchema = z.strictObject({});
export const AddTodoInputSchema = CreateTodoItemRequestSchema.strict();
export const CompleteTodoInputSchema = z.strictObject({ itemId: z.string().min(1).max(200) });
export const McpRequestSchema = z.discriminatedUnion("tool", [
  z.strictObject({ tool: z.literal("list_todos"), arguments: ListTodosInputSchema }),
  z.strictObject({ tool: z.literal("add_todo"), arguments: AddTodoInputSchema }),
  z.strictObject({ tool: z.literal("complete_todo"), arguments: CompleteTodoInputSchema }),
]);
export type McpRequest = z.infer<typeof McpRequestSchema>;
export const McpTodoSchema = TodoItemSchema.omit({ teamId: true });
export const mcpResponseSchemas = {
  list_todos: z.strictObject({
    items: z.array(McpTodoSchema),
    categories: TodoCategoriesResponseSchema.shape.categories,
  }),
  add_todo: z.strictObject({ item: McpTodoSchema }),
  complete_todo: z.strictObject({ id: z.string(), completed: z.literal(true) }),
};
export type McpData = z.infer<(typeof mcpResponseSchemas)[keyof typeof mcpResponseSchemas]>;
export type McpWireResult =
  | { ok: true; data: McpData }
  | { ok: false; error: { status: number; code: string; message: string } };
export const requiredMcpScope = (tool: McpRequest["tool"]) =>
  tool === "list_todos" ? "todos:read" : "todos:write";
