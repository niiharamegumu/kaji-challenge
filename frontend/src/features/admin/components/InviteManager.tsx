import { useEffect, useState } from "react";

import type { TeamMember } from "../../../lib/api/generated/client";
import { PushNotificationsSection } from "../../push/components/PushNotificationsSection";
import { COPY_FEEDBACK_TIMEOUT_MS } from "../constants/invite";
import type { InviteState } from "../state/ui";
import {
  AccountSettingsSection,
  InviteCodeIssueSection,
  JoinTeamSection,
  TeamMembersSection,
  TeamNameSection,
} from "./invite/InviteSections";
import {
  getColorHexError,
  getNicknameError,
  getTeamNameError,
} from "./invite/inviteUtils";

type Props = {
  invite: InviteState | null;
  joinCode: string;
  members: TeamMember[];
  nickname: string;
  colorHex: string;
  teamName: string;
  isCreatingInvite: boolean;
  isJoiningTeam: boolean;
  isLeavingTeam: boolean;
  isSavingNickname: boolean;
  isSavingColor: boolean;
  isSavingTeamName: boolean;
  onJoinCodeChange: (value: string) => void;
  onNicknameChange: (value: string) => void;
  onColorHexChange: (value: string) => void;
  onTeamNameChange: (value: string) => void;
  onCreateInvite: () => void;
  onJoinTeam: () => void;
  onLeaveTeam: () => void;
  onSaveNickname: () => void;
  onSaveColor: () => void;
  onSaveTeamName: () => void;
};

export function InviteManager({
  invite,
  joinCode,
  members,
  nickname,
  colorHex,
  teamName,
  isCreatingInvite,
  isJoiningTeam,
  isLeavingTeam,
  isSavingNickname,
  isSavingColor,
  isSavingTeamName,
  onJoinCodeChange,
  onNicknameChange,
  onColorHexChange,
  onTeamNameChange,
  onCreateInvite,
  onJoinTeam,
  onLeaveTeam,
  onSaveNickname,
  onSaveColor,
  onSaveTeamName,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCopied(false);
    }, COPY_FEEDBACK_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (invite == null) {
      return;
    }
    const timer = window.setInterval(() => {
      setCurrentTime(Date.now());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [invite]);

  const nicknameError = getNicknameError(nickname);
  const colorHexError = getColorHexError(colorHex);
  const teamNameError = getTeamNameError(teamName);
  const inviteExpired =
    invite != null && new Date(invite.expiresAt).getTime() < currentTime;

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
    <section className="space-y-2 pb-1 md:space-y-4">
      <header className="py-0.5">
        <h2 className="text-lg font-semibold text-stone-900">設定</h2>
        <p className="mt-2 text-xs text-stone-500">
          チーム設定とアカウント設定を管理できます。
        </p>
      </header>

      <article className="rounded-xl border border-stone-200 bg-white/90 p-2.5 shadow-sm md:rounded-2xl md:p-6">
        <h2 className="text-base font-semibold text-stone-900">チーム設定</h2>
        <div className="mt-3 space-y-6">
          <TeamNameSection
            teamName={teamName}
            teamNameError={teamNameError}
            isSavingTeamName={isSavingTeamName}
            onTeamNameChange={onTeamNameChange}
            onSaveTeamName={onSaveTeamName}
          />

          <div>
            <TeamMembersSection
              members={members}
              isLeavingTeam={isLeavingTeam}
              onLeaveTeam={onLeaveTeam}
            />
          </div>

          <div>
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

          <div>
            <JoinTeamSection
              joinCode={joinCode}
              isJoiningTeam={isJoiningTeam}
              onJoinCodeChange={onJoinCodeChange}
              onJoinTeam={onJoinTeam}
            />
          </div>
        </div>
      </article>

      <article className="rounded-xl border border-stone-200 bg-white/90 p-2.5 shadow-sm md:rounded-2xl md:p-6">
        <h2 className="text-base font-semibold text-stone-900">
          アカウント設定
        </h2>
        <div className="mt-3 space-y-6">
          <AccountSettingsSection
            nickname={nickname}
            colorHex={colorHex}
            nicknameError={nicknameError}
            colorHexError={colorHexError}
            isSavingNickname={isSavingNickname}
            isSavingColor={isSavingColor}
            onNicknameChange={onNicknameChange}
            onColorHexChange={onColorHexChange}
            onSaveNickname={onSaveNickname}
            onSaveColor={onSaveColor}
          />
          <PushNotificationsSection />
        </div>
      </article>
    </section>
  );
}
