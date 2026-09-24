import { drizzle } from "drizzle-orm/d1";
import { D1Repository } from "./repository";
import * as schema from "./schema";
import * as authSchema from "./auth-schema";

export function createDb(binding: D1Database) {
  return drizzle(binding, { schema: { ...schema, ...authSchema } });
}
export type Database = ReturnType<typeof createDb>;
export function createDatabase(binding: D1Database) {
  const db = createDb(binding);
  return { db, repository: new D1Repository(db), binding };
}
