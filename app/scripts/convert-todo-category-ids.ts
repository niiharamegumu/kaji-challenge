import { TodoCategoryNameSchema, TodoCategoryOrderSchema } from "../src/contracts/operations";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

type Statement = { sql: string; params?: (string | number | null)[] };
type Result = { results: Record<string, unknown>[]; meta: { changes: number } };
export type ConversionDatabase = { batch(statements: Statement[]): Promise<Result[]> };

// Explicit maintenance operation, never invoked by migrations or application requests.
export async function convertTodoCategoryIds(database: ConversionDatabase, apply = false) {
  const query = async (sql: string, params?: Statement["params"]) =>
    (await database.batch([{ sql, params }]))[0].results;
  const columns = await query("PRAGMA table_info(todo_items)");
  const categoryColumn = columns.some((column) => column.name === "category_id")
    ? "category_id"
    : "category";
  const teamColumns = await query("PRAGMA table_info(teams)");
  const hasSortKey = teamColumns.some((column) => column.name === "todo_unclassified_sort_key");
  const teams = await query(
    `SELECT id,todo_categories${hasSortKey ? ",todo_unclassified_sort_key" : ""} FROM teams`,
  );
  const plans: Statement[][] = [];
  for (const team of teams) {
    const original = String(team.todo_categories);
    const categories: unknown = JSON.parse(original);
    if (!Array.isArray(categories)) throw new Error("カテゴリー一覧が配列ではありません");
    const todos = await query(
      `SELECT ${categoryColumn} AS category FROM todo_items WHERE team_id=?`,
      [String(team.id)],
    );
    const legacy = categories.every((entry) => typeof entry === "string");
    if (!legacy) {
      const parsed = TodoCategoryOrderSchema.safeParse(categories);
      if (!parsed.success) throw new Error("カテゴリーのデータ形式が不正です");
      const ids = parsed.data.map((category) => category?.id ?? null);
      if (
        todos.some(
          (todo) =>
            todo.category !== null &&
            (typeof todo.category !== "string" || !ids.includes(todo.category)),
        )
      ) {
        throw new Error("変換済みカテゴリーとToDoの関連が不正です");
      }
      continue;
    }
    if (categoryColumn === "category_id" && categories.length > 0) {
      throw new Error(
        "旧カテゴリーが残っています。0007適用前のバックアップで未分類位置を確認してから復旧してください",
      );
    }
    if (
      categories.some((name) => !TodoCategoryNameSchema.safeParse(name).success) ||
      new Set(categories).size !== categories.length ||
      todos.some(
        (todo) =>
          todo.category !== null &&
          (typeof todo.category !== "string" || !categories.includes(todo.category)),
      )
    ) {
      throw new Error(
        "重複カテゴリーまたは未登録カテゴリーを参照するToDoがあります。書き込みは行っていません",
      );
    }
    const order: ({ id: string; name: string } | null)[] = categories.map((name) => ({
      id: randomUUID(),
      name,
    }));
    const position = hasSortKey ? Number(team.todo_unclassified_sort_key) : 0;
    if (!Number.isInteger(position) || position < 0 || position > order.length)
      throw new Error("未分類の位置が不正です");
    order.splice(position, 0, null);
    const converted = JSON.stringify(order);
    // Both writes share the same snapshot guard and one D1 transaction.
    const guard = `todo_categories=?${hasSortKey ? " AND todo_unclassified_sort_key=?" : ""}`;
    const guardParams = hasSortKey ? [original, position] : [original];
    plans.push([
      {
        sql: `UPDATE todo_items SET ${categoryColumn}=(SELECT json_extract(value,'$.id') FROM json_each(?) WHERE json_extract(value,'$.name')=todo_items.${categoryColumn}) WHERE team_id=? AND ${categoryColumn} IS NOT NULL AND EXISTS(SELECT 1 FROM teams WHERE id=todo_items.team_id AND ${guard})`,
        params: [converted, String(team.id), ...guardParams],
      },
      {
        sql: `UPDATE teams SET todo_categories=? WHERE id=? AND ${guard}`,
        params: [converted, String(team.id), ...guardParams],
      },
    ]);
  }
  if (apply) {
    for (const plan of plans) {
      const results = await database.batch(plan);
      if (results[1].meta.changes !== 1)
        throw new Error("実行中にカテゴリーが変更されました。メンテナンス状態を確認してください");
    }
  }
  return { teams: teams.length, converted: plans.length, applied: apply };
}

async function main() {
  const args = process.argv.slice(2);
  if (
    args.some((arg) => !["--local", "--remote", "--apply"].includes(arg)) ||
    args.includes("--local") === args.includes("--remote")
  ) {
    throw new Error("Usage: bun scripts/convert-todo-category-ids.ts --local|--remote [--apply]");
  }
  const apply = args.includes("--apply");
  if (args.includes("--local")) {
    const { getPlatformProxy } = await import("wrangler");
    const proxy = await getPlatformProxy<{ DB: D1Database }>({
      configPath: resolve("wrangler.jsonc"),
      envFiles: [],
      remoteBindings: false,
      persist: { path: resolve(".wrangler/state/v3") },
    });
    try {
      console.log(
        await convertTodoCategoryIds(
          {
            batch: (statements) =>
              proxy.env.DB.batch(
                statements.map(({ sql, params = [] }) => proxy.env.DB.prepare(sql).bind(...params)),
              ),
          },
          apply,
        ),
      );
    } finally {
      await proxy.dispose();
    }
  } else {
    const account = process.env.CLOUDFLARE_ACCOUNT_ID;
    const database = process.env.CLOUDFLARE_DATABASE_ID;
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!account || !database || !token)
      throw new Error(
        "CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_DATABASE_ID / CLOUDFLARE_API_TOKEN が必要です",
      );
    const adapter: ConversionDatabase = {
      async batch(statements) {
        const response = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/d1/database/${encodeURIComponent(database)}/query`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ batch: statements }),
          },
        );
        const body = (await response.json()) as { success: boolean; result: Result[] };
        if (!response.ok || !body.success)
          throw new Error(`D1操作に失敗しました (HTTP ${response.status})`);
        return body.result;
      },
    };
    console.log(await convertTodoCategoryIds(adapter, apply));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "変換に失敗しました");
    process.exitCode = 1;
  });
}
