import { useEffect, useState } from "react";

import type { TeamMember } from "../../../lib/api/operations";
import { PAGE_SECTION_CHROMELESS_CLASS_NAME } from "../../../shared/styles/pageSection";
import { PushNotificationsSection } from "../../push";
import { TodoDefaultCategorySettings } from "../../todos";
import { COPY_FEEDBACK_TIMEOUT_MS } from "../constants/invite";
import type { InviteState } from "../model/invite";
import {
  AccountSettingsSection,
  InviteCodeIssueSection,
  JoinTeamSection,
  TeamMembersSection,
  TeamNameSection,
} from "./SettingsSections";
import { getColorHexError, getNicknameError, getTeamNameError } from "./settingsUtils";
import { TodoCompletionSettings } from "./TodoCompletionSettings";

type Props = {
  identityKey: string;
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

export function SettingsManager({
  identityKey,
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
  const inviteExpiresAt = invite == null ? null : new Date(invite.expiresAt).getTime();

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
    if (inviteExpiresAt == null || inviteExpiresAt <= currentTime) {
      return;
    }
    const timer = window.setTimeout(
      () => {
        setCurrentTime(Date.now());
      },
      Math.min(2_147_483_647, Math.max(0, inviteExpiresAt - Date.now())),
    );
    return () => window.clearTimeout(timer);
  }, [inviteExpiresAt, currentTime]);

  const nicknameError = getNicknameError(nickname);
  const colorHexError = getColorHexError(colorHex);
  const teamNameError = getTeamNameError(teamName);
  const inviteExpired = inviteExpiresAt != null && inviteExpiresAt <= currentTime;

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
      <header className="py-0.5 md:px-6">
        <h2 className="text-lg font-semibold text-stone-900">設定</h2>
        <p className="mt-2 text-xs text-stone-500">
          チーム・アカウント・ブラウザーの設定を管理できます。
        </p>
      </header>

      <TodoCompletionSettings>
        <TodoDefaultCategorySettings key={identityKey} identityKey={identityKey} />
      </TodoCompletionSettings>

      <article
        className={`rounded-xl px-0 py-2.5 md:rounded-2xl md:p-6 ${PAGE_SECTION_CHROMELESS_CLASS_NAME}`}
      >
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

      <article
        className={`rounded-xl px-0 py-2.5 md:rounded-2xl md:p-6 ${PAGE_SECTION_CHROMELESS_CLASS_NAME}`}
      >
        <h2 className="text-base font-semibold text-stone-900">アカウント設定</h2>
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
          <PushNotificationsSection key={identityKey} />
        </div>
      </article>
    </section>
  );
}
