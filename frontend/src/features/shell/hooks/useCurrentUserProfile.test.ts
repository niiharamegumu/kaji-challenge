import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  MeResponse,
  TeamMember,
  User,
} from "../../../lib/api/generated/client";
import { useCurrentUserProfile } from "./useCurrentUserProfile";

const makeUser = (overrides?: Partial<User>): User => ({
  id: "u1",
  email: "owner@example.com",
  displayName: "Owner",
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("useCurrentUserProfile", () => {
  it("prefers team member nickname and color", () => {
    const meData: MeResponse = {
      user: makeUser({ colorHex: "#111111" }),
      memberships: [{ teamId: "t1", role: "owner", teamName: "Team A" }],
    };
    const members: TeamMember[] = [
      {
        userId: "u1",
        displayName: "Owner",
        nickname: "ニック",
        effectiveName: "ニック",
        colorHex: "#222222",
        joinedAt: "2026-01-01T00:00:00Z",
        role: "owner",
      },
    ];

    const { result } = renderHook(() => useCurrentUserProfile(meData, members));

    expect(result.current.currentUserId).toBe("u1");
    expect(result.current.currentTeamName).toBe("Team A");
    expect(result.current.currentUserName).toBe("ニック");
    expect(result.current.currentUserColorHex).toBe("#222222");
  });

  it("falls back to me displayName and me color when member data is missing", () => {
    const meData: MeResponse = {
      user: makeUser({ colorHex: "#111111" }),
      memberships: [{ teamId: "t1", role: "owner", teamName: "Team A" }],
    };

    const { result } = renderHook(() =>
      useCurrentUserProfile(meData, undefined),
    );

    expect(result.current.currentUserName).toBe("Owner");
    expect(result.current.currentUserColorHex).toBe("#111111");
  });

  it("returns safe defaults when me data is undefined", () => {
    const { result } = renderHook(() =>
      useCurrentUserProfile(undefined, undefined),
    );

    expect(result.current.currentUserId).toBeNull();
    expect(result.current.currentTeamName).toBe("チーム");
    expect(result.current.currentUserName).toBe("ログイン中");
    expect(result.current.currentUserColorHex).toBeNull();
  });
});
