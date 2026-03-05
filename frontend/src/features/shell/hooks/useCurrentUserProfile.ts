import { useMemo } from "react";

import type { MeResponse, TeamMember } from "../../../lib/api/generated/client";

export type CurrentUserProfile = {
  currentUserId: string | null;
  currentTeamName: string;
  currentUserName: string;
  currentUserColorHex: string | null;
};

export function useCurrentUserProfile(
  meData: MeResponse | undefined,
  members: TeamMember[] | undefined,
): CurrentUserProfile {
  const currentUserId = meData?.user.id ?? null;
  const currentTeamName = meData?.memberships?.[0]?.teamName ?? "チーム";
  const membersByUserId = useMemo(() => {
    const index = new Map<string, TeamMember>();
    for (const member of members ?? []) {
      if (!index.has(member.userId)) {
        index.set(member.userId, member);
      }
    }
    return index;
  }, [members]);
  const currentUserMember = useMemo(() => {
    if (currentUserId == null) {
      return undefined;
    }
    return membersByUserId.get(currentUserId);
  }, [membersByUserId, currentUserId]);
  const preferredNickname = currentUserMember?.nickname?.trim() ?? "";
  const currentUserName =
    preferredNickname.length > 0
      ? preferredNickname
      : (meData?.user.displayName ?? "ログイン中");
  const currentUserColorHex =
    currentUserMember?.colorHex ?? meData?.user.colorHex ?? null;

  return {
    currentUserId,
    currentTeamName,
    currentUserName,
    currentUserColorHex,
  };
}
