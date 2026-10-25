import { z } from "zod";
import { responseSchemas } from "./operations";

export const assistAudio = {
  sampleRate: 16_000,
  maxSeconds: 120,
  maxBytes: 3_840_044,
  maxBase64: 5_120_060,
} as const;
export const assistLimits = {
  items: 50,
  actions: 10,
  transcript: 2000,
  audioBodyBytes: 6 * 1024 * 1024,
  audioUploadBodyBytes: 4 * 1024 * 1024,
} as const;
const name = z.string().trim().min(1).max(100);
const categoryName = z.string().trim().min(1).max(50);
const draftItems = z
  .array(z.strictObject({ name: name.nullable(), categoryName: categoryName.nullable() }))
  .min(1)
  .max(assistLimits.items);
const addTodoIntentSchema = z.strictObject({ intent: z.literal("add_todo"), items: draftItems });
export const assistTodoActionSchema = z.discriminatedUnion("intent", [
  addTodoIntentSchema,
  z.strictObject({
    intent: z.literal("list_todos"),
    categoryName: categoryName.nullable(),
    nameQuery: name.nullable().optional(),
  }),
  z.strictObject({
    intent: z.enum(["complete_todos", "delete_todos"]),
    names: z.array(name).min(1).max(assistLimits.items),
    categoryName: categoryName.nullable(),
  }),
]);
const actionPlan = z
  .array(assistTodoActionSchema)
  .min(1)
  .max(assistLimits.actions)
  .refine(
    (actions) =>
      actions.reduce(
        (count, action) =>
          count +
          (action.intent === "add_todo"
            ? action.items.length
            : action.intent === "list_todos"
              ? 0
              : action.names.length),
        0,
      ) <= assistLimits.items,
  );
const mixedActions = actionPlan.min(2);
const controlIntents = [
  z.strictObject({ intent: z.literal("clarify") }),
  z.strictObject({ intent: z.literal("cancel_draft") }),
  z.strictObject({
    intent: z.literal("unsupported"),
    reason: z.enum(["too_many", "operation", "unclear"]),
  }),
] as const;
// Inference always enumerates successful actions, including single-action requests.
export const assistInferenceIntentSchema = z.discriminatedUnion("intent", [
  z.strictObject({ intent: z.literal("batch_todos"), actions: actionPlan }),
  ...controlIntents,
]);
export const assistDraftSchema = z.strictObject({
  items: draftItems,
  missing: z.enum(["name", "category"]),
  expiresAt: z.number().int().positive(),
  actions: mixedActions.optional(),
});
export const assistAudioUploadSchema = z.strictObject({
  audio: z
    .instanceof(Blob)
    .refine((audio) => audio.type === "audio/wav")
    .refine((audio) => audio.size >= 44 + 3200 && audio.size <= assistAudio.maxBytes),
  expectedTeamId: z.uuid(),
});
// Retain the JSON contract for PWA clients that have not loaded the new bundle yet.
export const assistAudioRequestSchema = z.strictObject({
  audioBase64: z
    .string()
    .min(60)
    .max(assistAudio.maxBase64)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  expectedTeamId: z.uuid(),
});
export const assistTranscriptionSchema = z.strictObject({
  transcript: z.string().trim().min(1).max(assistLimits.transcript),
});
export const assistRequestSchema = z.strictObject({
  transcript: assistTranscriptionSchema.shape.transcript,
  expectedTeamId: z.uuid(),
  pendingDraft: assistDraftSchema.optional(),
});
// Only an interpretation, never a database command. IDs and arbitrary tools are forbidden.
export const assistIntentSchema = z.discriminatedUnion("intent", [
  ...assistTodoActionSchema.options,
  z.strictObject({ intent: z.literal("batch_todos"), actions: mixedActions }),
  ...controlIntents,
]);
const common = {
  transcript: z.string().max(assistLimits.transcript),
  replyText: z.string().min(1).max(100),
};
export const assistOperationResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...common,
    kind: z.literal("added"),
    items: z.array(responseSchemas.postTodoItem).min(1).max(assistLimits.items),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("listed"),
    items: responseSchemas.listTodoItems.shape.items.max(20),
    total: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("removed"),
    action: z.enum(["complete", "delete"]),
    count: z.number().int().nonnegative(),
  }),
]);
export const assistResultSchema = z.discriminatedUnion("kind", [
  ...assistOperationResultSchema.options,
  z.strictObject({
    ...common,
    kind: z.literal("batch"),
    results: z.array(assistOperationResultSchema).min(2).max(assistLimits.actions),
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
export type AssistTodoAction = z.infer<typeof assistTodoActionSchema>;
export type AssistOperationResult = z.infer<typeof assistOperationResultSchema>;
export type AssistIntent = z.infer<typeof assistIntentSchema>;
export type AssistRequest = z.infer<typeof assistRequestSchema>;
export type AssistAudioRequest = z.infer<typeof assistAudioRequestSchema>;
export type AssistAudioUpload = z.infer<typeof assistAudioUploadSchema>;
export type AssistResult = z.infer<typeof assistResultSchema>;
