import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { and, eq } from "drizzle-orm";
import type { Database } from "./database";
import * as schema from "./auth-schema";
import { D1Repository } from "./repository";
import { provisionUser } from "../application/provision-user";
export interface AuthSettings {
  baseURL: string;
  secret: string;
  googleClientId: string;
  googleClientSecret: string;
  allowedEmails: string[];
}
export function createAuth(db: Database, settings: AuthSettings) {
  const allowed = new Set(
    settings.allowedEmails.map((email) => email.trim().toLowerCase()).filter(Boolean),
  );
  if (!allowed.size) throw new Error("Signup requires an email allowlist");
  if (!settings.secret || !settings.googleClientId || !settings.googleClientSecret)
    throw new Error("Authentication configuration is incomplete");
  return betterAuth({
    logger: {
      level: "warn",
      // Provider and database errors can include tokens, query parameters and personal data.
      log(level) {
        const event = JSON.stringify({ event: "auth_library_log", level });
        if (level === "error") console.error(event);
        else console.warn(event);
      },
    },
    baseURL: settings.baseURL,
    basePath: "/api/auth",
    secret: settings.secret,
    trustedOrigins: [new URL(settings.baseURL).origin],
    database: drizzleAdapter(db, { provider: "sqlite", schema, transaction: false }),
    advanced: {
      // Keep the same origin/CSRF protections in tests and production.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      database: { generateId: () => crypto.randomUUID() },
      useSecureCookies: new URL(settings.baseURL).protocol === "https:",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    },
    user: {
      additionalFields: {
        // Only business Server Functions may change these fields after checking team revision.
        nickname: { type: "string", required: false, input: false },
        colorHex: { type: "string", required: false, input: false },
      },
    },
    emailAndPassword: { enabled: false },
    session: {
      expiresIn: 30 * 24 * 60 * 60,
      updateAge: 0,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    account: {
      encryptOAuthTokens: true,
      accountLinking: { enabled: false },
      storeAccountCookie: false,
      storeStateStrategy: "database",
    },
    socialProviders: {
      google: {
        clientId: settings.googleClientId,
        clientSecret: settings.googleClientSecret,
        mapProfileToUser(profile) {
          if (!profile.email_verified)
            throw new APIError("FORBIDDEN", { message: "Google email must be verified" });
          return { email: profile.email.toLowerCase(), emailVerified: true };
        },
      },
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 100 },
    databaseHooks: {
      // Google identity is verified before persistence. This app does not use stored
      // ID tokens; Better Auth's OAuth encryption covers access/refresh tokens only.
      account: {
        create: { before: async (account) => ({ data: { ...account, idToken: null } }) },
        update: { before: async (account) => ({ data: { ...account, idToken: null } }) },
      },
      user: {
        create: {
          before: async (user) => {
            if (!allowed.has(user.email.toLowerCase()))
              throw new APIError("FORBIDDEN", {
                code: "signup_forbidden",
                message: "signup_forbidden",
              });
            return { data: user };
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const users = await db
              .select()
              .from(schema.user)
              .where(eq(schema.user.id, session.userId));
            const accounts = await db
              .select()
              .from(schema.account)
              .where(
                and(
                  eq(schema.account.userId, session.userId),
                  eq(schema.account.providerId, "google"),
                ),
              );
            if (!users[0] || !accounts[0])
              throw new APIError("FORBIDDEN", { message: "Google identity is required" });
            await provisionUser(new D1Repository(db), session.userId, new Date());
            return { data: session };
          },
        },
      },
    },
  });
}
