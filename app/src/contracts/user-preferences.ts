import { z } from "zod";

export const TodoCategorySelectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("all") }),
  z.strictObject({ kind: z.literal("unclassified") }),
  z.strictObject({ kind: z.literal("category"), id: z.uuid() }),
]);
export const UserPreferencesSchema = z.strictObject({
  todoCompletionDelayMs: z.union([
    z.literal(1000),
    z.literal(2000),
    z.literal(3000),
    z.literal(4000),
    z.literal(5000),
  ]),
  defaultTodoCategory: TodoCategorySelectionSchema,
});
export const UpdateUserPreferencesSchema = UserPreferencesSchema.partial().refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  "at least one preference is required",
);
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
export type UpdateUserPreferences = z.infer<typeof UpdateUserPreferencesSchema>;
export type TodoCategorySelection = z.infer<typeof TodoCategorySelectionSchema>;
export const defaultUserPreferences: UserPreferences = {
  todoCompletionDelayMs: 3000,
  defaultTodoCategory: { kind: "all" },
};
