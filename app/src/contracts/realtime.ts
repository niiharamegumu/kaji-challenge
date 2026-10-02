import { z } from "zod";

export const teamChangeScopeSchema = z.enum([
  "profile",
  "membership",
  "invite",
  "tasks",
  "task-completions",
  "todos",
  "todo-categories",
  "reminders",
  "penalty-rules",
  "month-close",
  "push-subscriptions",
]);
export type TeamChangeScope = z.infer<typeof teamChangeScopeSchema>;

export const realtimeMessageSchema = z.discriminatedUnion("type", [
  // 旧Workerや定期ジョブの通知は全体を再取得する。
  z.object({ type: z.literal("team-changed"), changes: z.array(teamChangeScopeSchema).optional() }),
  z.object({ type: z.literal("presence"), userIds: z.array(z.string()) }),
]);
export type RealtimeMessage = z.infer<typeof realtimeMessageSchema>;
