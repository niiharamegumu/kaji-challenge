import { and, eq, getTableColumns, getTableName, sql, type SQL } from "drizzle-orm";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import type { BatchItem } from "drizzle-orm/batch";
import type { Database } from "./database";
import { appRevision } from "./schema";
import { AppError } from "../domain/errors";

/** Request-local writes, committed once with a revision guard. Reads shadow changed
 * tables with CTEs so joins and aggregates also see pending inserts/updates/deletes.
 * Drizzle handles column names, parameters and Date/boolean codecs on both paths.
 */
export class UnitOfWork {
  readonly statements: BatchItem<"sqlite">[] = [];
  private readonly changes = new Map<SQLiteTable, Map<string, Record<string, unknown>>>();
  constructor(
    readonly db: Database,
    readonly active = false,
  ) {}

  private pendingTables() {
    return [...this.changes].map(([table, changes]) => {
      const name = getTableName(table);
      const columns = Object.values(getTableColumns(table));
      const rows = JSON.stringify([...changes.values()]);
      // Paths come only from schema columns; keep them literal to avoid consuming
      // D1's parameter budget once per column in every staged table.
      const path = (name: string) => sql.raw("'$." + name.replaceAll("'", "''") + "'");
      const match = sql.join(
        this.primaryKeys(table).map(
          (column) =>
            sql`base.${sql.identifier(column.name)} = json_extract(p.value, ${path(column.name)})`,
        ),
        sql` AND `,
      );
      return {
        name,
        query: sql`
        SELECT ${sql.join(
          columns.map((c) => sql`base.${sql.identifier(c.name)}`),
          sql`, `,
        )}
        FROM main.${sql.identifier(name)} base
        WHERE NOT EXISTS (SELECT 1 FROM json_each(${rows}) p WHERE ${match})
        UNION ALL
        SELECT ${sql.join(
          columns.map((c) => sql`json_extract(p.value, ${path(c.name)})`),
          sql`, `,
        )}
        FROM json_each(${rows}) p WHERE json_extract(p.value, '$._deleted') = 0`,
      };
    });
  }

  get read() {
    return this.db.with(
      ...this.pendingTables().map(({ name, query }) => this.db.$with(name, {}).as(query)),
    );
  }

  // Reserved for recursive SQL that cannot be expressed by Drizzle's SQLite builder.
  all<T extends Record<string, unknown>>(query: SQL, recursiveCtes?: SQL): Promise<T[]> {
    const ctes = this.pendingTables().map(
      ({ name, query }) => sql`${sql.identifier(name)} AS (${query})`,
    );
    if (recursiveCtes) ctes.push(recursiveCtes);
    return this.db.all<T>(
      ctes.length ? sql`WITH RECURSIVE ${sql.join(ctes, sql`, `)} ${query}` : query,
    );
  }

  private primaryKeys(table: SQLiteTable) {
    const config = getTableConfig(table);
    const keys = [
      ...config.columns.filter((column) => column.primary),
      ...config.primaryKeys.flatMap((key) => key.columns),
    ];
    if (!keys.length) throw new Error("Business writes require a primary key");
    return keys;
  }

  private identity(table: SQLiteTable, row: Record<string, unknown>) {
    const columns = getTableColumns(table);
    return and(
      ...this.primaryKeys(table).map((key) => {
        const property = Object.keys(columns).find((name) => columns[name] === key)!;
        return eq(key, row[property]);
      }),
    )!;
  }

  private remember(table: SQLiteTable, row: Record<string, unknown>, deleted: boolean) {
    if (!this.active) throw new Error("Business writes require a unit of work");
    const encoded = Object.fromEntries(
      Object.entries(getTableColumns(table)).map(([property, column]) => {
        const value = row[property];
        if (value === undefined)
          throw new Error(`Missing staged column: ${getTableName(table)}.${column.name}`);
        return [column.name, value === null ? null : column.mapToDriverValue(value)];
      }),
    );
    const changes = this.changes.get(table) ?? new Map<string, Record<string, unknown>>();
    changes.set(JSON.stringify(this.primaryKeys(table).map((key) => encoded[key.name])), {
      ...encoded,
      _deleted: Number(deleted),
    });
    this.changes.set(table, changes);
  }

  async insert<T extends SQLiteTable>(table: T, row: NoInfer<T["$inferSelect"]>) {
    this.remember(table, row, false);
    this.statements.push(this.db.insert(table).values(row));
  }

  async update<T extends SQLiteTable>(
    table: T,
    where: SQL,
    patch:
      | Partial<NoInfer<T["$inferSelect"]>>
      | ((row: NoInfer<T["$inferSelect"]>) => Partial<NoInfer<T["$inferSelect"]>>),
  ) {
    const rows = (await this.read
      .select()
      .from(table as SQLiteTable)
      .where(where)) as T["$inferSelect"][];
    for (const row of rows) {
      const changes = typeof patch === "function" ? patch(row) : patch;
      this.remember(table, { ...row, ...changes }, false);
      this.statements.push(this.db.update(table).set(changes).where(this.identity(table, row)));
    }
    return rows.length;
  }

  async remove<T extends SQLiteTable>(table: T, where: SQL) {
    const rows = await this.read
      .select()
      .from(table as SQLiteTable)
      .where(where);
    for (const row of rows) {
      this.remember(table, row, true);
      this.statements.push(this.db.delete(table).where(this.identity(table, row)));
    }
    return rows.length;
  }
}

async function version(db: Database) {
  const [row] = await db
    .select({ revision: sql<string>`CAST(${appRevision.revision} AS TEXT)` })
    .from(appRevision)
    .where(eq(appRevision.id, 1));
  if (!row) throw new Error("D1 schema is not initialized");
  return row.revision;
}

function isRevisionConflict(error: unknown): boolean {
  const seen = new Set<object>();
  while (error instanceof Error && !seen.has(error)) {
    seen.add(error);
    if (error.message.includes("NOT NULL constraint failed: app_revision.revision")) return true;
    error = error.cause;
  }
  return false;
}

export async function atomic<T>(db: Database, fn: (unit: UnitOfWork) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const expected = await version(db);
    const unit = new UnitOfWork(db, true);
    let result: T;
    try {
      result = await fn(unit);
    } catch (error) {
      if ((await version(db)) !== expected) continue;
      throw error;
    }
    if (!unit.statements.length) {
      if ((await version(db)) === expected) return result;
      continue;
    }
    try {
      // A failed CAS violates NOT NULL and rolls back the entire D1 batch.
      await db.batch([
        db
          .update(appRevision)
          .set({
            revision: sql`CASE WHEN CAST(${appRevision.revision} AS TEXT)=${expected} THEN ${appRevision.revision}+1 ELSE NULL END`,
          })
          .where(eq(appRevision.id, 1)),
        ...unit.statements,
      ]);
      return result;
    } catch (error) {
      if (!isRevisionConflict(error)) throw error;
    }
  }
  throw new AppError(409, "concurrent_update", "更新が競合しました。再操作してください。");
}
