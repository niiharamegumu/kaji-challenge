import { useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";

import type { RootLayoutOutletContext } from "../../shell/routes/RootLayout";
import { statusMessageAtom } from "../../shell/state/status";
import { InviteManager } from "../components/InviteManager";
import {
  useInviteMutations,
  useProfileMutations,
} from "../hooks/useAdminMutations";
import {
  useCurrentInviteQuery,
  useCurrentTeamMembersQuery,
} from "../hooks/useAdminQueries";
import type { InviteState } from "../state/ui";

export function AdminInvitesPage() {
  const { currentUserId, currentTeamName } =
    useOutletContext<RootLayoutOutletContext>();
  const [joinCode, setJoinCode] = useState("");
  const setStatus = useSetAtom(statusMessageAtom);
  const { createInvite, joinTeam, leaveTeam } = useInviteMutations(setStatus);
  const { updateNickname, updateColor, updateTeamName } =
    useProfileMutations(setStatus);
  const membersQuery = useCurrentTeamMembersQuery(Boolean(currentUserId));
  const currentInviteQuery = useCurrentInviteQuery(Boolean(currentUserId));

  const [nickname, setNickname] = useState("");
  const [colorHex, setColorHex] = useState("");
  const [teamName, setTeamName] = useState("");
  const [nicknameDirty, setNicknameDirty] = useState(false);
  const [colorHexDirty, setColorHexDirty] = useState(false);
  const [teamNameDirty, setTeamNameDirty] = useState(false);

  const invite: InviteState | null =
    currentInviteQuery.data == null
      ? null
      : {
          code: currentInviteQuery.data.code,
          expiresAt: currentInviteQuery.data.expiresAt,
        };
  const currentNickname =
    membersQuery.data?.find((member) => member.userId === currentUserId)
      ?.nickname ?? "";
  const currentColorHex =
    membersQuery.data?.find((member) => member.userId === currentUserId)
      ?.colorHex ?? "";

  useEffect(() => {
    if (teamNameDirty) {
      return;
    }
    setTeamName(currentTeamName);
  }, [currentTeamName, teamNameDirty]);

  useEffect(() => {
    if (currentUserId == null) {
      setNickname("");
      setNicknameDirty(false);
      setColorHex("");
      setColorHexDirty(false);
      return;
    }
    if (nicknameDirty) {
      if (colorHexDirty) {
        return;
      }
    }
    if (!nicknameDirty) {
      setNickname(currentNickname);
    }
    if (!colorHexDirty) {
      setColorHex(currentColorHex);
    }
  }, [
    colorHexDirty,
    currentColorHex,
    currentNickname,
    currentUserId,
    nicknameDirty,
  ]);

  const handleCreateInvite = async () => {
    try {
      await createInvite.mutateAsync();
      setStatus("招待コードを発行しました");
    } catch {
      // Error status is handled by mutation onError.
    }
  };

  const handleJoinTeam = async () => {
    try {
      await joinTeam.mutateAsync(joinCode);
      setJoinCode("");
    } catch {
      // Error status is handled by mutation onError.
    }
  };

  const handleLeaveTeam = async () => {
    try {
      await leaveTeam.mutateAsync();
    } catch {
      // Error status is handled by mutation onError.
    }
  };

  const handleSaveNickname = async () => {
    try {
      await updateNickname.mutateAsync(nickname);
      setNicknameDirty(false);
    } catch {
      // Error status is handled by mutation onError.
    }
  };

  const handleSaveColor = async () => {
    try {
      await updateColor.mutateAsync(
        colorHex.trim().length === 0 ? null : colorHex,
      );
      setColorHexDirty(false);
    } catch {
      // Error status is handled by mutation onError.
    }
  };

  const handleSaveTeamName = async () => {
    try {
      await updateTeamName.mutateAsync(teamName);
      setTeamNameDirty(false);
    } catch {
      // Error status is handled by mutation onError.
    }
  };

  return (
    <section className="mt-2 pb-1 md:mt-4">
      <InviteManager
        invite={invite}
        joinCode={joinCode}
        members={membersQuery.data ?? []}
        nickname={nickname}
        colorHex={colorHex}
        teamName={teamName}
        isCreatingInvite={createInvite.isPending}
        isJoiningTeam={joinTeam.isPending}
        isLeavingTeam={leaveTeam.isPending}
        isSavingNickname={updateNickname.isPending}
        isSavingColor={updateColor.isPending}
        isSavingTeamName={updateTeamName.isPending}
        onJoinCodeChange={setJoinCode}
        onNicknameChange={(value) => {
          setNickname(value);
          setNicknameDirty(true);
        }}
        onColorHexChange={(value) => {
          setColorHex(value);
          setColorHexDirty(true);
        }}
        onTeamNameChange={(value) => {
          setTeamName(value);
          setTeamNameDirty(true);
        }}
        onCreateInvite={() => {
          void handleCreateInvite();
        }}
        onJoinTeam={() => {
          void handleJoinTeam();
        }}
        onLeaveTeam={() => {
          void handleLeaveTeam();
        }}
        onSaveNickname={() => {
          void handleSaveNickname();
        }}
        onSaveColor={() => {
          void handleSaveColor();
        }}
        onSaveTeamName={() => {
          void handleSaveTeamName();
        }}
      />
    </section>
  );
}
