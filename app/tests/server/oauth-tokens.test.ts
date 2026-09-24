import { sql } from "drizzle-orm";
import { symmetricDecrypt } from "better-auth/crypto";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAuth } from "../../src/server/infrastructure/auth";
import { createTestDatabase } from "../helpers/d1";

const secret = "oauth-encryption-fixture-secret-at-least-32-characters";

describe("encrypted Google account persistence", () => {
  let connection: Awaited<ReturnType<typeof createTestDatabase>>;
  let auth: ReturnType<typeof createAuth>;
  let userId: string;
  const subject = crypto.randomUUID();
  const email = subject + "@example.com";
  beforeAll(async () => {
    connection = await createTestDatabase();
    auth = createAuth(connection.db, {
      baseURL: "https://app.example.com",
      secret,
      googleClientId: "test",
      googleClientSecret: "test",
      allowedEmails: [email],
    });
  });
  afterAll(async () => {
    if (!connection) return;
    if (userId) {
      for (const member of await connection.repository.ListMembershipsByUserID(userId))
        await connection.query(sql`DELETE FROM teams WHERE id=${member.TeamID}`);
    }
    await connection.query(sql`DELETE FROM auth_user WHERE email=${email}`);
    await connection.close();
  });

  async function login(accessToken: string, refreshToken?: string) {
    const context = await auth.$context;
    // Simulate the already-verified provider response. The real Better Auth OAuth
    // persistence pipeline and DB hooks run; Google's signature verification is not mocked as tested.
    const result = await handleOAuthUserInfo(
      { context } as Parameters<typeof handleOAuthUserInfo>[0],
      {
        userInfo: { id: subject, name: "OAuth fixture", email, emailVerified: true },
        account: {
          providerId: "google",
          accountId: subject,
          accessToken,
          refreshToken,
          idToken: "fixture-id-token-with-profile",
          accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        },
      },
    );
    expect(result.error).toBeNull();
    if (!result.data) throw new Error("OAuth login failed");
    userId = result.data.user.id;
    expect(result.data.session.userId).toBe(userId);
    return context;
  }
  async function stored() {
    const result = await connection.query(sql`SELECT access_token, refresh_token, id_token
      FROM auth_account WHERE user_id=${userId}`);
    return result.rows[0] as {
      access_token: string;
      refresh_token: string;
      id_token: string | null;
    };
  }
  async function expectTokens(access: string, refresh: string) {
    const row = await stored();
    expect(row.access_token).not.toBe(access);
    expect(row.refresh_token).not.toBe(refresh);
    expect(await symmetricDecrypt({ key: secret, data: row.access_token })).toBe(access);
    expect(await symmetricDecrypt({ key: secret, data: row.refresh_token })).toBe(refresh);
    expect(row.id_token).toBeNull();
    await expect(symmetricDecrypt({ key: "wrong-key", data: row.access_token })).rejects.toThrow();
  }

  it("encrypts initial OAuth tokens and creates the same user's session and team", async () => {
    await login("fixture-access-first", "fixture-refresh-first");
    await expectTokens("fixture-access-first", "fixture-refresh-first");
    expect(await connection.repository.ListMembershipsByUserID(userId)).toHaveLength(1);
  });
  it("encrypts subsequent login writes and preserves an omitted refresh token", async () => {
    const originalUser = userId;
    await login("fixture-access-second");
    expect(userId).toBe(originalUser);
    await expectTokens("fixture-access-second", "fixture-refresh-first");
  });
  it("decrypts for the provider and encrypts refreshed tokens before updating the DB", async () => {
    const context = await auth.$context;
    const provider = context.socialProviders.find((p) => p.id === "google")!;
    const refresh = vi.spyOn(provider, "refreshAccessToken").mockResolvedValue({
      accessToken: "fixture-access-renewed",
      refreshToken: "fixture-refresh-renewed",
      idToken: "fixture-id-token-renewed",
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    });
    try {
      const [account] = await context.internalAdapter.findAccounts(userId);
      await auth.api.refreshToken({ body: { accountId: account.id, userId } });
      expect(refresh).toHaveBeenCalledWith("fixture-refresh-first", expect.anything());
      await expectTokens("fixture-access-renewed", "fixture-refresh-renewed");
    } finally {
      refresh.mockRestore();
    }
  });
});
