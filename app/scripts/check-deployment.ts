// 本番CDの配備後に実行し、公開先の /health が対象releaseを返すことを確認する。
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deploymentSchema } from "../infra/config";

export async function verifyDeploymentHealth(
  origin: string,
  release: string,
  { attempts = 12, delayMs = 5_000 } = {},
) {
  // Reject invalid destinations before sending requests. Do not print response bodies.
  if (
    !deploymentSchema.safeParse({
      stage: "production",
      origin,
      release,
      jobs: "false",
      maintenance: "false",
    }).success
  ) {
    throw new Error("Invalid production origin or release");
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(new URL("/health", origin), {
        signal: AbortSignal.timeout(5_000),
        redirect: "error",
        cache: "no-store",
      });
      if (response.ok) {
        const body = await response.json();
        if (
          typeof body === "object" &&
          body !== null &&
          "status" in body &&
          body.status === "ok" &&
          "release" in body &&
          body.release === release
        )
          return;
      } else {
        await response.body?.cancel();
      }
    } catch {
      // A Worker update may take time to become reachable; retry for a bounded period.
    }
    if (attempt + 1 < attempts) await new Promise((done) => setTimeout(done, delayMs));
  }
  throw new Error("Production health did not confirm the expected release");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyDeploymentHealth(process.env.APP_ORIGIN ?? "", process.env.APP_RELEASE ?? "");
  console.info("Production health and release verified.");
}
