import { closeOutstanding, notifyOutstanding, crons } from "../application/jobs";
import { createDatabase } from "../infrastructure/database";
import { createDelivery } from "../infrastructure/push";
import type { RuntimeBindings } from "./runtime.server";
export async function scheduled(controller: ScheduledController, bindings: RuntimeBindings) {
  if (bindings.JOBS_ENABLED !== "true" || bindings.MAINTENANCE_MODE === "true") return;
  const connection = createDatabase(bindings.DB);
  const now = new Date(controller.scheduledTime);
  const key = (Object.keys(crons) as (keyof typeof crons)[]).find(
    (k) => crons[k] === controller.cron,
  );
  if (!key) throw new Error("Unknown cron expression");
  if (key === "day" || key === "week") await closeOutstanding(connection.repository, key, now);
  else
    await notifyOutstanding(
      connection.repository,
      createDelivery(connection.db, {
        subject: bindings.VAPID_SUBJECT,
        publicKey: bindings.VAPID_PUBLIC_KEY,
        privateKey: bindings.VAPID_PRIVATE_KEY,
      }),
      key,
      now,
    );
}
