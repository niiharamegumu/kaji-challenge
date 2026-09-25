import { readFile, readdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy, unstable_splitSqlQuery, unstable_readConfig } from "wrangler";
import type { SQL } from "drizzle-orm";
import { createDatabase } from "../../src/server/infrastructure/database";

export async function createTestDatabase(persistPath?: string, through?: string) {
  // Keep real .dev.vars and application secrets out of the fixture runtime.
  const directory = await mkdtemp(join(tmpdir(), "kaji-d1-fixture-"));
  const source = unstable_readConfig({
    config: new URL("../../wrangler.jsonc", import.meta.url).pathname,
  });
  const configPath = join(directory, "wrangler.json");
  await writeFile(
    configPath,
    JSON.stringify({
      name: "kaji-tests",
      compatibility_date: source.compatibility_date,
      d1_databases: source.d1_databases,
    }),
  );
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath,
    envFiles: [],
    persist: persistPath ? { path: join(persistPath, "v3") } : false,
    remoteBindings: false,
  });
  const close = async () => {
    await proxy.dispose();
    await rm(directory, { recursive: true, force: true });
  };
  try {
    const database = createDatabase(proxy.env.DB);
    const migrations = new URL("../../migrations/", import.meta.url);
    if (
      !(await proxy.env.DB.prepare("SELECT name FROM sqlite_master WHERE name='teams'").first())
    ) {
      for (const file of (await readdir(migrations))
        .filter((name) => name.endsWith(".sql") && (!through || name <= through))
        .sort()) {
        const schema = await readFile(new URL(file, migrations), "utf8");
        await proxy.env.DB.batch(
          unstable_splitSqlQuery(schema).map((query) => proxy.env.DB.prepare(query)),
        );
      }
    }
    return {
      ...database,
      query: async (query: SQL) => ({
        rows: await database.db.all<Record<string, unknown>>(query),
      }),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
