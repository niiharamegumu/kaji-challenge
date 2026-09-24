import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthCallbackPage, authCallbackLoader } from "./AuthCallbackPage";
const mockSession = vi.fn(),
  mockFlash = vi.fn(),
  mockSearch = vi.fn(),
  mockNavigate = vi.fn();
vi.mock("../api/authClient", () => ({
  authClient: { getSession: (...args: unknown[]) => mockSession(...args) },
}));
vi.mock("../state/flash", () => ({ writeFlashStatus: (...args: unknown[]) => mockFlash(...args) }));
vi.mock("../../../shared/router/navigation", () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(mockSearch()), vi.fn()],
}));
vi.mock("../../../app/boot", () => ({
  useMarkInitialScreenReady: () => {},
  useBootFlow: () => ({ markAuthResolved: vi.fn() }),
}));
describe("Better Auth callback", () => {
  beforeEach(() => {
    mockSession.mockReset();
    mockFlash.mockReset();
    mockSearch.mockReset();
    mockNavigate.mockReset();
  });
  afterEach(cleanup);
  it("verifies the server session before showing login success", async () => {
    mockSession.mockResolvedValue({ data: { user: { id: "existing-id" } }, error: null });
    const response = await authCallbackLoader();
    expect(mockFlash).toHaveBeenCalledWith("ログインしました", "login_success");
    expect(response.headers.get("Location")).toBe("/");
  });
  it.each([
    { data: null, error: null },
    { data: null, error: { message: "expired" } },
  ])("handles missing and failed sessions", async (result) => {
    mockSession.mockResolvedValue(result);
    expect((await authCallbackLoader()).status).toBe(302);
    expect(mockFlash).toHaveBeenCalledWith("ログインに失敗しました。再度ログインしてください。");
  });
  it("shows a friendly access-denied page instead of raw JSON", () => {
    mockSearch.mockReturnValue("error=signup_forbidden");
    render(<AuthCallbackPage />);
    expect(screen.getByRole("heading", { name: "ログインできませんでした" })).toBeInTheDocument();
    expect(
      screen.getByText(/このアカウントは現在の利用対象に登録されていません/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ログイン画面に戻る" })).toHaveAttribute("href", "/");
    expect(screen.queryByText(/signup_forbidden/)).not.toBeInTheDocument();
    expect(mockSession).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
  it("uses a generic message for other OAuth errors", () => {
    mockSearch.mockReturnValue("error=state_mismatch");
    render(<AuthCallbackPage />);
    expect(
      screen.getByText("ログイン処理を完了できませんでした。もう一度お試しください。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/state_mismatch/)).not.toBeInTheDocument();
  });
  it("does not treat a legacy exchange code as a session", async () => {
    mockSession.mockResolvedValue({ data: null });
    await authCallbackLoader();
    expect(mockFlash).not.toHaveBeenCalledWith("ログインしました", "login_success");
  });
});
