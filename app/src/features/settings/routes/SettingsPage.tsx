import { useSetAtom } from "jotai";
import { useState } from "react";
import { useOutletContext } from "../../../shared/router/navigation";

import type { RootLayoutOutletContext } from "../../../shared/router/rootLayoutContext";
import { statusMessageAtom } from "../../../shared/state/status";
import { SettingsManager } from "../components/SettingsManager";
import {
  useInviteMutations,
  useProfileMutations,
  useTeamSettingsQueries,
} from "../hooks/useSettings";
import type { InviteState } from "../model/invite";

type Draft = { key: string | null; value: string };

export function SettingsPage() {
  const { currentUserId, currentTeamId, currentTeamName } =
    useOutletContext<RootLayoutOutletContext>();
  const [joinCode, setJoinCode] = useState("");
  const setStatus = useSetAtom(statusMessageAtom);
  const { createInvite, joinTeam, leaveTeam } = useInviteMutations(setStatus);
  const { updateNickname, updateColor, updateTeamName } = useProfileMutations(setStatus);
  const { membersQuery, currentInviteQuery } = useTeamSettingsQueries();

  const [nicknameDraft, setNicknameDraft] = useState<Draft | null>(null);
  const [colorHexDraft, setColorHexDraft] = useState<Draft | null>(null);
  const [teamNameDraft, setTeamNameDraft] = useState<Draft | null>(null);

  const invite: InviteState | null =
    currentInviteQuery.data == null
      ? null
      : {
          code: currentInviteQuery.data.code,
          expiresAt: currentInviteQuery.data.expiresAt,
        };
  const currentMember = membersQuery.data.find((member) => member.userId === currentUserId);
  const currentTeamKey = `${currentUserId}:${currentTeamId}`;
  const nickname =
    nicknameDraft?.key === currentUserId ? nicknameDraft.value : (currentMember?.nickname ?? "");
  const colorHex =
    colorHexDraft?.key === currentUserId ? colorHexDraft.value : (currentMember?.colorHex ?? "");
  const teamName = teamNameDraft?.key === currentTeamKey ? teamNameDraft.value : currentTeamName;

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

  return (
    <section className="mt-2 pb-1 md:mt-4">
      <SettingsManager
        invite={invite}
        joinCode={joinCode}
        members={membersQuery.data}
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
          setNicknameDraft({ key: currentUserId, value });
        }}
        onColorHexChange={(value) => {
          setColorHexDraft({ key: currentUserId, value });
        }}
        onTeamNameChange={(value) => {
          setTeamNameDraft({ key: currentTeamKey, value });
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
          if (updateNickname.isPending) return;
          updateNickname.mutate(nickname, {
            onSuccess: () =>
              setNicknameDraft((current) => (current === nicknameDraft ? null : current)),
          });
        }}
        onSaveColor={() => {
          if (updateColor.isPending) return;
          updateColor.mutate(colorHex.trim() || null, {
            onSuccess: () =>
              setColorHexDraft((current) => (current === colorHexDraft ? null : current)),
          });
        }}
        onSaveTeamName={() => {
          if (updateTeamName.isPending) return;
          updateTeamName.mutate(teamName, {
            onSuccess: () =>
              setTeamNameDraft((current) => (current === teamNameDraft ? null : current)),
          });
        }}
      />
    </section>
  );
}
