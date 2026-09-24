import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/sqlite-core";

// Persist canonical UTC ISO strings while preserving Better Auth's runtime types.
const isoDate = customType<{ data: Date; driverData: string }>({
  dataType: () => "text",
  toDriver: (value) => value.toISOString(),
  fromDriver: (value) => new Date(value),
});
// Better Auth performs arithmetic and conditional updates on epoch milliseconds.
const isoEpoch = customType<{ data: number; driverData: string }>({
  dataType: () => "text",
  toDriver: (value) => new Date(value).toISOString(),
  fromDriver: (value) => new Date(value).getTime(),
});

const createdAt = () =>
  isoDate("created_at")
    .notNull()
    .$defaultFn(() => new Date());
const updatedAt = () =>
  isoDate("updated_at")
    .notNull()
    .$defaultFn(() => new Date());
export const user = sqliteTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  nickname: text("nickname"),
  colorHex: text("color_hex"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
export const session = sqliteTable(
  "auth_session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: isoDate("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_session_user_idx").on(t.userId)],
);
export const account = sqliteTable(
  "auth_account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    accountId: text("account_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: isoDate("access_token_expires_at"),
    refreshTokenExpiresAt: isoDate("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("account_provider_identity_uq").on(t.providerId, t.accountId),
    index("auth_account_user_idx").on(t.userId),
  ],
);
export const verification = sqliteTable(
  "auth_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: isoDate("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_verification_identifier_idx").on(t.identifier)],
);
export const rateLimit = sqliteTable("auth_rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: isoEpoch("last_request").notNull(),
});
