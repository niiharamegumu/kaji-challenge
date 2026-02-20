import { useEffect, useState } from "react";

import type { TeamMember } from "../../../lib/api/generated/client";
import { COPY_FEEDBACK_TIMEOUT_MS } from "../constants/invite";
import type { InviteState } from "../state/ui";
import {
  AccountSettingsSection,
  InviteCodeIssueSection,
  JoinTeamSection,
  TeamMembersSection,
  TeamNameSection,
} from "./invite/InviteSections";
import { getNicknameError, getTeamNameError } from "./invite/inviteUtils";

type Props = {
  invite: InviteState | null;
  joinCode: string;
  members: TeamMember[];
  nickname: string;
  teamName: string;
  isCreatingInvite: boolean;
  isJoiningTeam: boolean;
  isLeavingTeam: boolean;
  isSavingNickname: boolean;
  isSavingTeamName: boolean;
  onJoinCodeChange: (value: string) => void;
  onNicknameChange: (value: string) => void;
  onTeamNameChange: (value: string) => void;
  onCreateInvite: () => void;
  onJoinTeam: () => void;
  onLeaveTeam: () => void;
  onSaveNickname: () => void;
  onSaveTeamName: () => void;
};

export function InviteManager({
  invite,
  joinCode,
  members,
  nickname,
  teamName,
  isCreatingInvite,
  isJoiningTeam,
  isLeavingTeam,
  isSavingNickname,
  isSavingTeamName,
  onJoinCodeChange,
  onNicknameChange,
  onTeamNameChange,
  onCreateInvite,
  onJoinTeam,
  onLeaveTeam,
  onSaveNickname,
  onSaveTeamName,
}: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCopied(false);
    }, COPY_FEEDBACK_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const nicknameError = getNicknameError(nickname);
  const teamNameError = getTeamNameError(teamName);
  const inviteExpired =
    invite != null && new Date(invite.expiresAt).getTime() < Date.now();

  const handleCopyInviteCode = async () => {
    if (!invite?.code) {
      return;
    }

    try {
      await navigator.clipboard.writeText(invite.code);
      setCopied(true);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = invite.code;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (success) {
        setCopied(true);
      }
    }
  };

  return (
    <section className="space-y-4 pb-2">
      <header className="px-1 py-1">
        <h2 className="text-lg font-semibold text-stone-900">設定</h2>
        <p className="mt-1 text-sm text-stone-600">
          チーム設定とアカウント設定を管理できます。
        </p>
      </header>

      <article className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm md:p-6">
        <h2 className="text-base font-semibold text-stone-900">チーム設定</h2>
        <div className="mt-4 space-y-5">
          <TeamNameSection
            teamName={teamName}
            teamNameError={teamNameError}
            isSavingTeamName={isSavingTeamName}
            onTeamNameChange={onTeamNameChange}
            onSaveTeamName={onSaveTeamName}
          />

          <div className="border-t border-stone-200 pt-5">
            <TeamMembersSection
              members={members}
              isLeavingTeam={isLeavingTeam}
              onLeaveTeam={onLeaveTeam}
            />
          </div>

          <div className="border-t border-stone-200 pt-5">
            <InviteCodeIssueSection
              invite={invite}
              inviteExpired={inviteExpired}
              copied={copied}
              isCreatingInvite={isCreatingInvite}
              onCreateInvite={onCreateInvite}
              onCopyInviteCode={() => {
                void handleCopyInviteCode();
              }}
            />
          </div>

          <div className="border-t border-stone-200 pt-5">
            <JoinTeamSection
              joinCode={joinCode}
              isJoiningTeam={isJoiningTeam}
              onJoinCodeChange={onJoinCodeChange}
              onJoinTeam={onJoinTeam}
            />
          </div>
        </div>
      </article>

      <article className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm md:p-6">
        <h2 className="text-base font-semibold text-stone-900">
          アカウント設定
        </h2>
        <div className="mt-4">
          <AccountSettingsSection
            nickname={nickname}
            nicknameError={nicknameError}
            isSavingNickname={isSavingNickname}
            onNicknameChange={onNicknameChange}
            onSaveNickname={onSaveNickname}
          />
        </div>
      </article>
    </section>
  );
}
