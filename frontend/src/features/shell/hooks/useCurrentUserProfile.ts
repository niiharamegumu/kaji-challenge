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
  const currentUserMember =
    currentUserId == null
      ? undefined
      : members?.find((member) => member.userId === currentUserId);
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
