import { useAtom } from "jotai";
import { useEffect, useState } from "react";

import { useMeQuery } from "../../auth/hooks/useAuthActions";
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
import { inviteCodeAtom, joinCodeAtom } from "../state/ui";

export function AdminInvitesPage() {
  const [inviteCode, setInviteCode] = useAtom(inviteCodeAtom);
  const [joinCode, setJoinCode] = useAtom(joinCodeAtom);
  const [, setStatus] = useAtom(statusMessageAtom);
  const { createInvite, joinTeam, leaveTeam } = useInviteMutations(setStatus);
  const { updateNickname, updateTeamName } = useProfileMutations(setStatus);
  const meQuery = useMeQuery(true);
  const membersQuery = useCurrentTeamMembersQuery(
    Boolean(meQuery.data?.user.id),
  );
  const currentInviteQuery = useCurrentInviteQuery(
    Boolean(meQuery.data?.user.id),
  );

  const [nickname, setNickname] = useState("");
  const [teamName, setTeamName] = useState("");
  const [nicknameDirty, setNicknameDirty] = useState(false);
  const [teamNameDirty, setTeamNameDirty] = useState(false);

  const currentTeamName = meQuery.data?.memberships?.[0]?.teamName ?? "";
  const currentUserId = meQuery.data?.user.id;
  const currentNickname =
    membersQuery.data?.find((member) => member.userId === currentUserId)
      ?.nickname ?? "";

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
      return;
    }
    if (nicknameDirty) {
      return;
    }
    setNickname(currentNickname);
  }, [currentNickname, currentUserId, nicknameDirty]);

  useEffect(() => {
    if (!currentInviteQuery.isSuccess) {
      return;
    }
    if (currentInviteQuery.data == null) {
      setInviteCode(null);
      return;
    }
    setInviteCode({
      code: currentInviteQuery.data.code,
      expiresAt: currentInviteQuery.data.expiresAt,
    });
  }, [currentInviteQuery.data, currentInviteQuery.isSuccess, setInviteCode]);

  const handleCreateInvite = async () => {
    try {
      const res = await createInvite.mutateAsync();
      setInviteCode({ code: res.data.code, expiresAt: res.data.expiresAt });
      setStatus("招待コードを発行しました");
    } catch {
      // Error status is handled by mutation onError.
    }
  };

  const handleJoinTeam = async () => {
    try {
      await joinTeam.mutateAsync(joinCode);
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

  const handleSaveTeamName = async () => {
    try {
      await updateTeamName.mutateAsync(teamName);
      setTeamNameDirty(false);
    } catch {
      // Error status is handled by mutation onError.
    }
  };

  return (
    <section className="mt-4 pb-2">
      <InviteManager
        invite={inviteCode}
        joinCode={joinCode}
        members={membersQuery.data ?? []}
        nickname={nickname}
        teamName={teamName}
        isCreatingInvite={createInvite.isPending}
        isJoiningTeam={joinTeam.isPending}
        isLeavingTeam={leaveTeam.isPending}
        isSavingNickname={updateNickname.isPending}
        isSavingTeamName={updateTeamName.isPending}
        onJoinCodeChange={setJoinCode}
        onNicknameChange={(value) => {
          setNickname(value);
          setNicknameDirty(true);
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
        onSaveTeamName={() => {
          void handleSaveTeamName();
        }}
      />
    </section>
  );
}
