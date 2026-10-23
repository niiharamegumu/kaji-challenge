import { z } from "zod";
import { responseSchemas } from "./operations";

export const assistAudio = { sampleRate: 16_000, maxSeconds: 15, maxBase64: 640_060 } as const;
const name = z.string().trim().min(1).max(100);
const categoryName = z.string().trim().min(1).max(50);
const draftItems = z
  .array(z.strictObject({ name: name.nullable(), categoryName: categoryName.nullable() }))
  .min(1)
  .max(10);
export const assistDraftSchema = z.strictObject({
  items: draftItems,
  missing: z.enum(["name", "category"]),
  expiresAt: z.number().int().positive(),
});
export const assistRequestSchema = z.strictObject({
  audioBase64: z
    .string()
    .min(60)
    .max(assistAudio.maxBase64)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  expectedTeamId: z.uuid(),
  pendingDraft: assistDraftSchema.optional(),
});
// Only an interpretation, never a database command. IDs and arbitrary tools are forbidden.
export const assistIntentSchema = z.discriminatedUnion("intent", [
  z.strictObject({
    intent: z.literal("add_todo"),
    items: draftItems,
  }),
  z.strictObject({ intent: z.literal("list_todos"), categoryName: categoryName.nullable() }),
  z.strictObject({ intent: z.literal("clarify") }),
  z.strictObject({ intent: z.literal("cancel_draft") }),
  z.strictObject({
    intent: z.literal("unsupported"),
    reason: z.enum(["too_many", "operation", "unclear"]),
  }),
]);
const common = { transcript: z.string().max(500), replyText: z.string().min(1).max(100) };
export const assistResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...common,
    kind: z.literal("added"),
    items: z.array(responseSchemas.postTodoItem).min(1).max(10),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("listed"),
    items: responseSchemas.listTodoItems.shape.items.max(20),
    total: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("clarify"),
    pendingDraft: assistDraftSchema,
    categories: z.array(categoryName).max(20),
  }),
  z.strictObject({ ...common, kind: z.enum(["unsupported", "cancelled"]) }),
]);
export const assistErrorSchema = z.strictObject({ code: z.string(), message: z.string().max(200) });
export type AssistDraft = z.infer<typeof assistDraftSchema>;
export type AssistIntent = z.infer<typeof assistIntentSchema>;
export type AssistRequest = z.infer<typeof assistRequestSchema>;
export type AssistResult = z.infer<typeof assistResultSchema>;
