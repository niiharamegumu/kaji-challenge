import { act, cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsManager } from "./SettingsManager";

vi.mock("../../push", () => ({ PushNotificationsSection: () => null }));
vi.mock("./TodoCompletionSettings", () => ({ TodoCompletionSettings: () => null }));

const props: ComponentProps<typeof SettingsManager> = {
  identityKey: "user:team",
  invite: null,
  joinCode: "",
  members: [],
  nickname: "",
  colorHex: "#112233",
  teamName: "Team",
  isCreatingInvite: false,
  isJoiningTeam: false,
  isLeavingTeam: false,
  isSavingNickname: false,
  isSavingColor: false,
  isSavingTeamName: false,
  onJoinCodeChange: vi.fn(),
  onNicknameChange: vi.fn(),
  onColorHexChange: vi.fn(),
  onTeamNameChange: vi.fn(),
  onCreateInvite: vi.fn(),
  onJoinTeam: vi.fn(),
  onLeaveTeam: vi.fn(),
  onSaveNickname: vi.fn(),
  onSaveColor: vi.fn(),
  onSaveTeamName: vi.fn(),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-16T00:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("marks an invite expired at its deadline and stops scheduling updates", () => {
  render(
    <SettingsManager {...props} invite={{ code: "INVITE", expiresAt: "2026-10-16T00:01:30Z" }} />,
  );
  act(() => vi.advanceTimersByTime(89_999));
  expect(screen.queryByText(/この招待コードは期限切れ/)).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByText(/この招待コードは期限切れ/)).toBeInTheDocument();
  expect(vi.getTimerCount()).toBe(0);
});

it("replaces the expiry deadline when a new invite is issued and cleans up on unmount", () => {
  const view = render(
    <SettingsManager {...props} invite={{ code: "OLD", expiresAt: "2026-10-16T00:01:30Z" }} />,
  );
  act(() => vi.advanceTimersByTime(60_000));
  view.rerender(
    <SettingsManager {...props} invite={{ code: "NEW", expiresAt: "2026-10-16T00:03:00Z" }} />,
  );
  act(() => vi.advanceTimersByTime(30_000));
  expect(screen.queryByText(/この招待コードは期限切れ/)).not.toBeInTheDocument();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("handles a 30-day invite without overflowing the browser timeout limit", () => {
  render(
    <SettingsManager {...props} invite={{ code: "LONG", expiresAt: "2026-11-15T00:00:00Z" }} />,
  );
  act(() => vi.advanceTimersByTime(2_147_483_647));
  expect(screen.queryByText(/この招待コードは期限切れ/)).not.toBeInTheDocument();
  expect(vi.getTimerCount()).toBe(1);
  act(() => vi.advanceTimersByTime(30 * 86_400_000 - 2_147_483_647));
  expect(screen.getByText(/この招待コードは期限切れ/)).toBeInTheDocument();
  expect(vi.getTimerCount()).toBe(0);
});
