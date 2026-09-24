import { beforeEach, describe, expect, it, vi } from "vitest";
import { authCallbackLoader } from "./AuthCallbackPage";
const mockSession = vi.fn(),
  mockFlash = vi.fn();
vi.mock("../api/authClient", () => ({
  authClient: { getSession: (...args: unknown[]) => mockSession(...args) },
}));
vi.mock("../state/flash", () => ({ writeFlashStatus: (...args: unknown[]) => mockFlash(...args) }));
const callback = (search = "") =>
  authCallbackLoader({ request: new Request(`http://localhost/auth/callback${search}`) });
describe("Better Auth callback", () => {
  beforeEach(() => {
    mockSession.mockReset();
    mockFlash.mockReset();
  });
  it("verifies the server session before showing login success", async () => {
    mockSession.mockResolvedValue({ data: { user: { id: "existing-id" } }, error: null });
    const response = await callback();
    expect(mockFlash).toHaveBeenCalledWith("ログインしました", "login_success");
    expect(response.headers.get("Location")).toBe("/");
  });
  it.each([
    { data: null, error: null },
    { data: null, error: { message: "expired" } },
  ])("handles missing and failed sessions", async (result) => {
    mockSession.mockResolvedValue(result);
    expect((await callback()).status).toBe(302);
    expect(mockFlash).toHaveBeenCalledWith("ログインに失敗しました。再度ログインしてください。");
  });
  it("preserves invite-only signup feedback", async () => {
    await callback("?error=signup_forbidden");
    expect(mockSession).not.toHaveBeenCalled();
    expect(mockFlash).toHaveBeenCalledWith("このアカウントは現在の招待制リリース対象外です。");
  });
  it("does not treat a legacy exchange code as a session", async () => {
    mockSession.mockResolvedValue({ data: null });
    await callback("?exchangeCode=old-code");
    expect(mockFlash).not.toHaveBeenCalledWith("ログインしました", "login_success");
  });
});
