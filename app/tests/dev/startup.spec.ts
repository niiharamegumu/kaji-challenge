import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

test("development entry hydrates and runtime writes do not reload the page", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  const reloads: string[] = [];
  const runtimeFile = new URL(
    `../../.wrangler/reload-regression-${randomUUID()}.sqlite-wal`,
    import.meta.url,
  );
  await mkdir(new URL("../../.wrangler/", import.meta.url), { recursive: true });
  await writeFile(runtimeFile, "runtime-initial");
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) =>
    socket.on("framereceived", (event) => {
      const payload = String(event.payload);
      if (payload.includes('"full-reload"')) {
        reloads.push(payload);
        // Bound CPU load even if a regression reintroduces the reload loop.
        if (reloads.length >= 3) void page.close().catch(() => {});
      }
    }),
  );
  try {
    const response = await request.get("/");
    expect(response.status()).toBe(200);
    expect(await response.text()).not.toContain('src="/src/main.tsx"');
    const sessionResponse = page.waitForResponse((result) => result.url().includes("/_serverFn/"));
    await page.goto("/");
    // A missing session is expected; broken runtime settings or origin checks are not.
    expect(await (await sessionResponse).text()).toContain("unauthorized");
    await expect(page.getByRole("button", { name: "Googleでログイン", exact: true })).toBeVisible();
    await expect(page.locator("#boot-splash")).toHaveCount(0);
    for (let index = 0; index < 5; index++) {
      await writeFile(runtimeFile, `runtime-update-${index}`);
      await request.get("/health");
      // Observe HMR after runtime writes; waiting is the behavior under test.
      await page.waitForTimeout(500);
    }
    expect(reloads).toEqual([]);
    await page.reload();
    await expect(page.getByRole("button", { name: "Googleでログイン", exact: true })).toBeVisible();
    await expect(page.locator("#boot-splash")).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(reloads).toEqual([]);
  } finally {
    await rm(runtimeFile, { force: true });
    await test.info().attach("development-events", {
      body: JSON.stringify({ errors, reloads }),
      contentType: "application/json",
    });
  }
});
