import { afterAll, beforeAll, expect, it } from "vitest";
import { getTableName, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import * as business from "../../src/server/infrastructure/schema";
import * as auth from "../../src/server/infrastructure/auth-schema";
import { createTestDatabase } from "../helpers/d1";

let connection: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  connection = await createTestDatabase();
});
afterAll(async () => {
  await connection?.close();
});

it("maps every migrated table, column, primary key and foreign key to Drizzle", async () => {
  const tables = Object.values({ ...business, ...auth });
  // D1 owns this metadata table; it is not an application migration.
  const actual = await connection.db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_METADATA'`,
  );
  expect(tables.map(getTableName).sort()).toEqual(actual.map((row) => row.name).sort());
  for (const table of tables) {
    const config = getTableConfig(table);
    const columns = await connection.db.all<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>(sql`PRAGMA table_info(${sql.identifier(config.name)})`);
    expect(config.columns.map((column) => column.name).sort(), config.name).toEqual(
      columns.map((column) => column.name).sort(),
    );
    for (const column of config.columns) {
      const actual = columns.find((row) => row.name === column.name)!;
      expect(column.getSQLType().toUpperCase(), `${config.name}.${column.name}`).toBe(actual.type);
      expect(column.notNull, `${config.name}.${column.name}`).toBe(
        Boolean(actual.notnull || actual.pk),
      );
    }
    const keys = [
      ...config.columns.filter((column) => column.primary),
      ...config.primaryKeys.flatMap((key) => key.columns),
    ];
    expect(keys.map((column) => column.name).sort(), config.name).toEqual(
      columns
        .filter((column) => column.pk)
        .map((column) => column.name)
        .sort(),
    );
    const foreignKeys = await connection.db.all<{
      from: string;
      to: string;
      table: string;
      on_delete: string;
    }>(sql`PRAGMA foreign_key_list(${sql.identifier(config.name)})`);
    const expected = config.foreignKeys.flatMap((key) => {
      const reference = key.reference();
      return reference.columns.map(
        (column, index) =>
          `${column.name}:${getTableName(reference.foreignTable)}.${reference.foreignColumns[index].name}:${key.onDelete?.toUpperCase()}`,
      );
    });
    expect(expected.sort(), config.name).toEqual(
      foreignKeys.map((key) => `${key.from}:${key.table}.${key.to}:${key.on_delete}`).sort(),
    );
  }
});
