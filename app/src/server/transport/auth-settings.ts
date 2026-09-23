import { AppError } from "../domain/errors";
import type { AuthSettings } from "../infrastructure/auth";

type AuthBindings = Partial<
  Record<
    | "APP_ORIGIN"
    | "BETTER_AUTH_SECRET"
    | "GOOGLE_CLIENT_ID"
    | "GOOGLE_CLIENT_SECRET"
    | "SIGNUP_ALLOWED_EMAILS",
    string
  >
>;

export function authSettings(bindings: AuthBindings): AuthSettings {
  const required = [
    "APP_ORIGIN",
    "BETTER_AUTH_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
  ] as const;
  const missing: string[] = required.filter((key) => !bindings[key]?.trim());
  if (!bindings.SIGNUP_ALLOWED_EMAILS?.split(",").some((email) => email.trim()))
    missing.push("SIGNUP_ALLOWED_EMAILS");
  let validOrigin = false;
  try {
    const origin = new URL(bindings.APP_ORIGIN ?? "");
    validOrigin =
      (origin.protocol === "https:" ||
        (origin.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))) &&
      origin.pathname === "/" &&
      !origin.username &&
      !origin.password &&
      !origin.search &&
      !origin.hash;
  } catch {
    /* Invalid or missing origin is a configuration error. */
  }
  const validSecret = (bindings.BETTER_AUTH_SECRET?.trim().length ?? 0) >= 32;
  if (missing.length || !validOrigin || !validSecret) {
    // Log key names only. Binding values may contain OAuth credentials and personal data.
    console.error(
      JSON.stringify({ event: "auth_configuration_invalid", missing, validOrigin, validSecret }),
    );
    throw new AppError(
      503,
      "configuration_unavailable",
      "ログイン設定を確認中です。管理者にお問い合わせください。",
    );
  }
  return {
    baseURL: bindings.APP_ORIGIN!,
    secret: bindings.BETTER_AUTH_SECRET!,
    googleClientId: bindings.GOOGLE_CLIENT_ID!,
    googleClientSecret: bindings.GOOGLE_CLIENT_SECRET!,
    allowedEmails: (bindings.SIGNUP_ALLOWED_EMAILS ?? "").split(","),
  };
}
