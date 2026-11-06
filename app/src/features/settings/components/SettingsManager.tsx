import { useEffect, useState } from "react";

import type { TeamMember } from "../../../lib/api/operations";
import { PushNotificationsSection } from "../../push";
import { TodoDefaultCategorySettings } from "../../todos";
import { COPY_FEEDBACK_TIMEOUT_MS } from "../constants/invite";
import type { InviteState } from "../model/invite";
import {
  AccountSettingsSection,
  InviteCodeIssueSection,
  JoinTeamSection,
  LeaveTeamSection,
  TeamMembersSection,
  TeamNameSection,
} from "./SettingsSections";
import { getColorHexError, getNicknameError, getTeamNameError } from "./settingsUtils";
import { TodoCompletionSettings } from "./TodoCompletionSettings";
import { ThemeSettings } from "./ThemeSettings";
import { AppUpdateSettings } from "./AppUpdateSettings";
import {
  SETTINGS_CATEGORIES,
  SettingsNavigation,
  type SettingsCategory,
} from "./SettingsNavigation";

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
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>("profile");
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
    <section className="space-y-5 pb-1 md:space-y-6">
      <header>
        <h2 className="text-xl font-semibold tracking-tight text-heading">設定</h2>
        <p className="mt-1.5 text-sm text-secondary">
          毎日使いやすい、自分たちの家事チャレンジに。
        </p>
      </header>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-8">
        <SettingsNavigation activeCategory={activeCategory} onSelect={setActiveCategory} />
        <div className="min-w-0">
          {SETTINGS_CATEGORIES.map(({ id, label, scope }) => (
            <article
              key={id}
              id={`settings-${id}`}
              hidden={activeCategory !== id}
              aria-labelledby={`settings-${id}-heading`}
              className="min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-6"
            >
              <header className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4">
                <h2 id={`settings-${id}-heading`} className="text-base font-semibold text-heading">
                  {label}
                </h2>
                <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs text-secondary">
                  {scope}
                </span>
              </header>
              {id === "profile" ? (
                <>
                  <p className="mb-5 text-sm leading-relaxed text-secondary">
                    チームに表示する名前と、自分の目印になるカラーを設定します。
                  </p>
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
                </>
              ) : null}
              {id === "appearance" ? <ThemeSettings /> : null}
              {id === "todos" ? (
                <div className="divide-y divide-line">
                  <TodoCompletionSettings />
                  <div className="mt-6 pt-6">
                    <TodoDefaultCategorySettings key={identityKey} identityKey={identityKey} />
                  </div>
                </div>
              ) : null}
              {id === "notifications" ? <PushNotificationsSection key={identityKey} /> : null}
              {id === "team" ? (
                <div className="space-y-6">
                  <TeamNameSection
                    teamName={teamName}
                    teamNameError={teamNameError}
                    isSavingTeamName={isSavingTeamName}
                    onTeamNameChange={onTeamNameChange}
                    onSaveTeamName={onSaveTeamName}
                  />
                  <TeamMembersSection members={members} />
                  <div className="border-t border-line pt-6">
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
                  <details className="group border-t border-line pt-4">
                    <summary className="min-h-11 cursor-pointer rounded-lg py-3 text-sm font-medium text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                      チームの参加・切り替え
                    </summary>
                    <div className="space-y-6 pt-3">
                      <p className="text-xs leading-relaxed text-muted">
                        参加や離脱をすると、現在のチームから移動します。
                      </p>
                      <JoinTeamSection
                        joinCode={joinCode}
                        isJoiningTeam={isJoiningTeam}
                        onJoinCodeChange={onJoinCodeChange}
                        onJoinTeam={onJoinTeam}
                      />
                      <LeaveTeamSection isLeavingTeam={isLeavingTeam} onLeaveTeam={onLeaveTeam} />
                    </div>
                  </details>
                </div>
              ) : null}
              {id === "app" ? <AppUpdateSettings /> : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
