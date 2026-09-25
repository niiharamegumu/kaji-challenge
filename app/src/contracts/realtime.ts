import { z } from "zod";

export const realtimeMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("team-changed") }),
  z.object({ type: z.literal("presence"), userIds: z.array(z.string()) }),
]);
export type RealtimeMessage = z.infer<typeof realtimeMessageSchema>;
