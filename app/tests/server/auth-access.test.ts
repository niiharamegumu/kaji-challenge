import { createHmac } from "node:crypto";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createAuth } from "../../src/server/infrastructure/auth";
import { createTestDatabase } from "../helpers/d1";

const origin = "https://app.example.com";
const settings = {
  baseURL: origin,
  secret: "access-fixture-secret-at-least-32-characters",
  googleClientId: "test",
  googleClientSecret: "test",
  allowedEmails: ["  Allowed@Example.com  "],
};
let connection: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  connection = await createTestDatabase();
});
afterAll(async () => {
  await connection?.close();
});

function authFor(email: string) {
  return createAuth(connection.db, { ...settings, allowedEmails: [email] });
}
async function oauth(auth: ReturnType<typeof createAuth>, email: string, subject: string) {
  const context = await auth.$context;
  // Provider claims are already verified here. Exercise Better Auth's real persistence hooks.
  return handleOAuthUserInfo({ context } as Parameters<typeof handleOAuthUserInfo>[0], {
    userInfo: { id: subject, name: "Access fixture", email, emailVerified: true },
    account: { providerId: "google", accountId: subject },
  });
}
async function counts() {
  const tables = ["auth_user", "auth_account", "auth_session", "teams", "team_members"];
  return Promise.all(
    tables.map((table) =>
      connection.binding.prepare(`SELECT count(*) AS n FROM ${table}`).first<number>("n"),
    ),
  );
}
function cookie(token: string) {
  const signature = createHmac("sha256", settings.secret).update(token).digest("base64");
  return `__Secure-better-auth.session_token=${encodeURIComponent(token + "." + signature)}`;
}

it.each([{ allowedEmails: [] }, { allowedEmails: ["", "  "] }])(
  "requires a non-empty allowlist even outside the runtime wrapper",
  ({ allowedEmails }) => {
    expect(() => createAuth(connection.db, { ...settings, allowedEmails })).toThrow("allowlist");
  },
);
it.each(["denied@example.com", "allowed@example.com.attacker.test", "allowed+alias@example.com"])(
  "rejects unlisted OAuth registration without leaving users, accounts, sessions or teams: %s",
  async (email) => {
    const auth = createAuth(connection.db, settings);
    const before = await counts();
    await expect(oauth(auth, email, crypto.randomUUID())).rejects.toMatchObject({
      status: "FORBIDDEN",
      body: { message: "signup_forbidden" },
    });
    expect(await counts()).toEqual(before);
  },
);
it("normalizes the allowlist and preserves a registered Google identity after list removal", async () => {
  const subject = crypto.randomUUID();
  const first = await oauth(createAuth(connection.db, settings), "allowed@example.com", subject);
  expect(first.error).toBeNull();
  if (!first.data) throw new Error("No allowed session");
  const again = await oauth(authFor("someone-else@example.com"), "allowed@example.com", subject);
  expect(again.error).toBeNull();
  expect(again.data?.user.id).toBe(first.data.user.id);
  expect(await connection.repository.ListMembershipsByUserID(first.data.user.id)).toHaveLength(1);
});
it("does not link another Google subject based on matching email", async () => {
  const email = crypto.randomUUID() + "@example.com";
  const auth = authFor(email);
  const first = await oauth(auth, email, crypto.randomUUID());
  expect(first.data).not.toBeNull();
  const before = await counts();
  const other = await oauth(auth, email, crypto.randomUUID());
  expect(other.data).toBeNull();
  expect(other.error).toBe("account not linked");
  expect(await counts()).toEqual(before);
});
it.each([false, undefined])(
  "rejects Google profiles without a verified email (%s)",
  async (email_verified) => {
    const auth = createAuth(connection.db, settings);
    const provider = (await auth.$context).socialProviders.find((p) => p.id === "google")!;
    // This tests profile policy after signature verification, not Google's signature validation.
    const claims = Buffer.from(
      JSON.stringify({ sub: "fixture", email: "allowed@example.com", email_verified }),
    ).toString("base64url");
    await expect(provider.getUserInfo({ idToken: `e30.${claims}.fixture` })).rejects.toThrow(
      "Google email must be verified",
    );
  },
);
it.each(["/sign-up/email", "/sign-in/email"])(
  "does not offer password authentication through %s",
  async (path) => {
    const auth = createAuth(connection.db, settings);
    const before = await counts();
    const response = await auth.handler(
      new Request(origin + "/api/auth" + path, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Bypass",
          email: "allowed@example.com",
          password: "test-password-only",
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await counts()).toEqual(before);
  },
);
it("rejects expired, revoked and forged session cookies", async () => {
  const email = crypto.randomUUID() + "@example.com";
  const auth = authFor(email);
  const result = await oauth(auth, email, crypto.randomUUID());
  if (!result.data) throw new Error("No session");
  const { session } = result.data;
  const headers = new Headers({ cookie: cookie(session.token) });
  const initial = await auth.handler(new Request(origin + "/api/auth/get-session", { headers }));
  expect(((await initial.json()) as { user: { id: string } }).user.id).toBe(result.data.user.id);
  expect(
    await auth.api.getSession({
      headers: new Headers({ cookie: cookie(session.token) + "tampered" }),
    }),
  ).toBeNull();
  await connection.binding
    .prepare("UPDATE auth_session SET expires_at=? WHERE id=?")
    .bind(new Date(Date.now() - 60_000).toISOString(), session.id)
    .run();
  expect(await auth.api.getSession({ headers })).toBeNull();
  const next = await (await auth.$context).internalAdapter.createSession(result.data.user.id);
  if (!next) throw new Error("No new session");
  await connection.binding.prepare("DELETE FROM auth_session WHERE id=?").bind(next.id).run();
  expect(
    await auth.api.getSession({ headers: new Headers({ cookie: cookie(next.token) }) }),
  ).toBeNull();
});
it("rejects cross-site authentication requests and external callback redirects", async () => {
  const auth = createAuth(connection.db, settings);
  for (const [requestOrigin, callbackURL] of [
    ["https://attacker.example", origin],
    [origin, "https://attacker.example"],
  ]) {
    const response = await auth.handler(
      new Request(origin + "/api/auth/sign-in/social", {
        method: "POST",
        headers: {
          origin: requestOrigin,
          "content-type": "application/json",
          cookie: cookie("fixture"),
        },
        body: JSON.stringify({ provider: "google", callbackURL }),
      }),
    );
    expect(response.status).toBe(403);
  }
});
