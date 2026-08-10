import { useSetAtom } from "jotai";
import { useActionState, useState, useTransition } from "react";
import { useOutletContext } from "react-router-dom";

import type { RootLayoutOutletContext } from "../../../shared/router/rootLayoutContext";
import { statusMessageAtom } from "../../../shared/state/status";
import { InviteManager } from "../components/InviteManager";
import {
  useInviteMutations,
  useProfileMutations,
} from "../hooks/useAdminMutations";
import { useTeamSettingsQueries } from "../hooks/useAdminQueries";
import type { InviteState } from "../state/ui";

type SaveProfileActionState = {
  status: "idle" | "success" | "error";
};

const initialSaveProfileActionState: SaveProfileActionState = {
  status: "idle",
};

export function AdminInvitesPage() {
  const { currentUserId, currentTeamName } =
    useOutletContext<RootLayoutOutletContext>();
  const [joinCode, setJoinCode] = useState("");
  const [, startTransition] = useTransition();
  const setStatus = useSetAtom(statusMessageAtom);
  const { createInvite, joinTeam, leaveTeam } = useInviteMutations(setStatus);
  const { updateNickname, updateColor, updateTeamName } =
    useProfileMutations(setStatus);
  const { membersQuery, currentInviteQuery } =
    useTeamSettingsQueries(currentUserId);

  const [nicknameDraft, setNicknameDraft] = useState("");
  const [colorHexDraft, setColorHexDraft] = useState("");
  const [teamNameDraft, setTeamNameDraft] = useState("");
  const [nicknameDraftUserId, setNicknameDraftUserId] = useState<string | null>(
    null,
  );
  const [colorHexDraftUserId, setColorHexDraftUserId] = useState<string | null>(
    null,
  );
  const [teamNameDraftKey, setTeamNameDraftKey] = useState("");
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
    membersQuery.data.find((member) => member.userId === currentUserId)
      ?.nickname ?? "";
  const currentColorHex =
    membersQuery.data.find((member) => member.userId === currentUserId)
      ?.colorHex ?? "";
  const currentTeamKey = `${currentUserId ?? "anonymous"}:${currentTeamName}`;
  const nickname =
    nicknameDirty && nicknameDraftUserId === currentUserId
      ? nicknameDraft
      : currentNickname;
  const colorHex =
    colorHexDirty && colorHexDraftUserId === currentUserId
      ? colorHexDraft
      : currentColorHex;
  const teamName =
    teamNameDirty && teamNameDraftKey === currentTeamKey
      ? teamNameDraft
      : currentTeamName;

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

  const [, saveNicknameAction, isSavingNickname] = useActionState(
    async (
      _prev: SaveProfileActionState,
      nextNickname: string,
    ): Promise<SaveProfileActionState> => {
      try {
        await updateNickname.mutateAsync(nextNickname);
        setNicknameDraft(nextNickname);
        setNicknameDraftUserId(currentUserId);
        setNicknameDirty(false);
        return { status: "success" };
      } catch {
        // Error status is handled by mutation onError.
        return { status: "error" };
      }
    },
    initialSaveProfileActionState,
  );

  const [, saveColorAction, isSavingColor] = useActionState(
    async (
      _prev: SaveProfileActionState,
      nextColorHex: string,
    ): Promise<SaveProfileActionState> => {
      try {
        await updateColor.mutateAsync(
          nextColorHex.trim().length === 0 ? null : nextColorHex,
        );
        setColorHexDraft(nextColorHex);
        setColorHexDraftUserId(currentUserId);
        setColorHexDirty(false);
        return { status: "success" };
      } catch {
        // Error status is handled by mutation onError.
        return { status: "error" };
      }
    },
    initialSaveProfileActionState,
  );

  const [, saveTeamNameAction, isSavingTeamName] = useActionState(
    async (
      _prev: SaveProfileActionState,
      nextTeamName: string,
    ): Promise<SaveProfileActionState> => {
      try {
        await updateTeamName.mutateAsync(nextTeamName);
        setTeamNameDraft(nextTeamName);
        setTeamNameDraftKey(currentTeamKey);
        setTeamNameDirty(false);
        return { status: "success" };
      } catch {
        // Error status is handled by mutation onError.
        return { status: "error" };
      }
    },
    initialSaveProfileActionState,
  );

  return (
    <section className="mt-2 pb-1 md:mt-4">
      <InviteManager
        invite={invite}
        joinCode={joinCode}
        members={membersQuery.data}
        nickname={nickname}
        colorHex={colorHex}
        teamName={teamName}
        isCreatingInvite={createInvite.isPending}
        isJoiningTeam={joinTeam.isPending}
        isLeavingTeam={leaveTeam.isPending}
        isSavingNickname={isSavingNickname}
        isSavingColor={isSavingColor}
        isSavingTeamName={isSavingTeamName}
        onJoinCodeChange={setJoinCode}
        onNicknameChange={(value) => {
          setNicknameDraft(value);
          setNicknameDraftUserId(currentUserId);
          setNicknameDirty(true);
        }}
        onColorHexChange={(value) => {
          setColorHexDraft(value);
          setColorHexDraftUserId(currentUserId);
          setColorHexDirty(true);
        }}
        onTeamNameChange={(value) => {
          setTeamNameDraft(value);
          setTeamNameDraftKey(currentTeamKey);
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
          startTransition(() => {
            saveNicknameAction(nickname);
          });
        }}
        onSaveColor={() => {
          startTransition(() => {
            saveColorAction(colorHex);
          });
        }}
        onSaveTeamName={() => {
          startTransition(() => {
            saveTeamNameAction(teamName);
          });
        }}
      />
    </section>
  );
}
