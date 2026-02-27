import { Check, Copy, RefreshCw, Users } from "lucide-react";

import type { TeamMember } from "../../../../lib/api/generated/client";
import {
  getReadableTextColor,
  resolveUserColor,
} from "../../../../shared/utils/userColor";
import type { InviteState } from "../../state/ui";
import { formatDateTime } from "./inviteUtils";

type TeamNameSectionProps = {
  teamName: string;
  teamNameError: string;
  isSavingTeamName: boolean;
  onTeamNameChange: (value: string) => void;
  onSaveTeamName: () => void;
};

export function TeamNameSection({
  teamName,
  teamNameError,
  isSavingTeamName,
  onTeamNameChange,
  onSaveTeamName,
}: TeamNameSectionProps) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-stone-900">チーム名</h3>
      <div>
        <label className="sr-only" htmlFor="team-name">
          チーム名
        </label>
        <input
          id="team-name"
          className="min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 focus-visible:border-[color:var(--color-matcha-500)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-matcha-200)]"
          value={teamName}
          onChange={(event) => onTeamNameChange(event.target.value)}
          placeholder="チーム名"
          disabled={isSavingTeamName}
        />
        {teamNameError && (
          <p className="mt-1 text-xs text-rose-600">{teamNameError}</p>
        )}
        <div className="mt-3 flex justify-start">
          <button
            type="button"
            className="min-h-11 rounded-lg border border-stone-400 px-4 py-2 text-sm whitespace-nowrap text-stone-800 transition-colors duration-200 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onSaveTeamName}
            disabled={isSavingTeamName || teamNameError.length > 0}
          >
            {isSavingTeamName ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </section>
  );
}

type TeamMembersSectionProps = {
  members: TeamMember[];
  isLeavingTeam: boolean;
  onLeaveTeam: () => void;
};

export function TeamMembersSection({
  members,
  isLeavingTeam,
  onLeaveTeam,
}: TeamMembersSectionProps) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-stone-900">チームメンバー</h3>
      <ul className="space-y-2">
        {members.map((member) => (
          <li
            key={member.userId}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm"
          >
            <Users size={14} aria-hidden="true" className="text-stone-500" />
            <span
              className="rounded-full px-2 py-0.5 font-medium"
              style={{
                backgroundColor: resolveUserColor(member.colorHex),
                color: getReadableTextColor(resolveUserColor(member.colorHex)),
              }}
            >
              {member.effectiveName}
            </span>
            <span className="rounded bg-white px-2 py-0.5 text-xs text-stone-600">
              {member.role === "owner" ? "owner" : "member"}
            </span>
            <span className="text-xs text-stone-600">
              参加日: {formatDateTime(member.joinedAt)}
            </span>
          </li>
        ))}
        {members.length === 0 && (
          <li className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-500">
            メンバー情報がありません
          </li>
        )}
      </ul>

      <div className="rounded-lg border border-rose-200 bg-rose-50/70 p-3">
        <p className="text-xs text-rose-700">
          離脱すると新しいチームを作成します。
        </p>
        <div className="mt-2 flex justify-start">
          <button
            type="button"
            className="min-h-11 rounded-lg border border-rose-300 px-4 py-2 text-sm text-rose-700 transition-colors duration-200 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onLeaveTeam}
            disabled={isLeavingTeam}
          >
            {isLeavingTeam ? "処理中..." : "離脱して新しいチームを作成"}
          </button>
        </div>
      </div>
    </section>
  );
}

type InviteCodeIssueSectionProps = {
  invite: InviteState | null;
  inviteExpired: boolean;
  copied: boolean;
  isCreatingInvite: boolean;
  onCreateInvite: () => void;
  onCopyInviteCode: () => void;
};

export function InviteCodeIssueSection({
  invite,
  inviteExpired,
  copied,
  isCreatingInvite,
  onCreateInvite,
  onCopyInviteCode,
}: InviteCodeIssueSectionProps) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-stone-900">招待コード</h3>
      <div className="flex flex-wrap items-center gap-1.5 text-sm text-stone-800">
        <span>コード:</span>
        <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] tracking-wide">
          {invite?.code ?? "未発行"}
        </code>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-md text-stone-600 transition-colors duration-200 hover:bg-stone-100 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onCopyInviteCode}
          disabled={!invite?.code}
          aria-label={copied ? "招待コードをコピー済み" : "招待コードをコピー"}
          title={copied ? "コピー済み" : "コピー"}
        >
          {copied ? (
            <Check size={14} aria-hidden="true" />
          ) : (
            <Copy size={14} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-md text-stone-600 transition-colors duration-200 hover:bg-stone-100 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onCreateInvite}
          disabled={isCreatingInvite}
          aria-label={
            isCreatingInvite ? "招待コードを発行中" : "招待コードを発行"
          }
          title={isCreatingInvite ? "発行中..." : "招待コード発行"}
        >
          <RefreshCw
            size={14}
            aria-hidden="true"
            className={isCreatingInvite ? "animate-spin" : undefined}
          />
        </button>
      </div>
      <p className="text-sm text-stone-600">
        有効期限: {invite?.expiresAt ? formatDateTime(invite.expiresAt) : "-"}
      </p>
      {inviteExpired && (
        <p className="text-sm text-rose-700">
          この招待コードは期限切れです。再発行してください。
        </p>
      )}
    </section>
  );
}

type JoinTeamSectionProps = {
  joinCode: string;
  isJoiningTeam: boolean;
  onJoinCodeChange: (value: string) => void;
  onJoinTeam: () => void;
};

export function JoinTeamSection({
  joinCode,
  isJoiningTeam,
  onJoinCodeChange,
  onJoinTeam,
}: JoinTeamSectionProps) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-stone-900">チーム参加</h3>
      <label className="sr-only" htmlFor="join-code">
        招待コード
      </label>
      <div>
        <input
          id="join-code"
          className="min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 focus-visible:border-[color:var(--color-matcha-500)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-matcha-200)]"
          value={joinCode}
          onChange={(event) => onJoinCodeChange(event.target.value)}
          placeholder="招待コード入力"
          disabled={isJoiningTeam}
        />
        <div className="mt-3 flex justify-start">
          <button
            type="button"
            className="flex min-h-11 items-center justify-center rounded-lg border border-stone-400 px-4 py-2 text-sm whitespace-nowrap text-stone-800 transition-colors duration-200 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onJoinTeam}
            disabled={isJoiningTeam || joinCode.trim().length === 0}
          >
            <span>{isJoiningTeam ? "参加中..." : "参加"}</span>
          </button>
        </div>
      </div>
    </section>
  );
}

type AccountSettingsSectionProps = {
  nickname: string;
  colorHex: string;
  nicknameError: string;
  colorHexError: string;
  isSavingNickname: boolean;
  isSavingColor: boolean;
  onNicknameChange: (value: string) => void;
  onColorHexChange: (value: string) => void;
  onSaveNickname: () => void;
  onSaveColor: () => void;
};

export function AccountSettingsSection({
  nickname,
  colorHex,
  nicknameError,
  colorHexError,
  isSavingNickname,
  isSavingColor,
  onNicknameChange,
  onColorHexChange,
  onSaveNickname,
  onSaveColor,
}: AccountSettingsSectionProps) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-stone-900">ニックネーム</h3>
      <div>
        <label className="sr-only" htmlFor="nickname">
          ニックネーム
        </label>
        <input
          id="nickname"
          className="min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 focus-visible:border-[color:var(--color-matcha-500)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-matcha-200)]"
          value={nickname}
          onChange={(event) => onNicknameChange(event.target.value)}
          placeholder="ニックネーム（未入力でも保存可能）"
          disabled={isSavingNickname}
        />
        {nicknameError && (
          <p className="mt-1 text-xs text-rose-600">{nicknameError}</p>
        )}
        <div className="mt-3 flex justify-start">
          <button
            type="button"
            className="flex min-h-11 items-center justify-center rounded-lg border border-stone-400 px-4 py-2 text-sm whitespace-nowrap text-stone-800 transition-colors duration-200 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onSaveNickname}
            disabled={isSavingNickname || nicknameError.length > 0}
          >
            <span>{isSavingNickname ? "保存中..." : "保存"}</span>
          </button>
        </div>
      </div>
      <div className="border-t border-stone-200 pt-3">
        <h3 className="text-sm font-semibold text-stone-900">表示カラー</h3>
        <label className="sr-only" htmlFor="color-hex">
          表示カラー
        </label>
        <div className="mt-2 flex items-center gap-2">
          <input
            id="color-picker"
            type="color"
            className="h-11 w-12 rounded border border-stone-300 bg-white p-1"
            value={resolveUserColor(colorHex)}
            onChange={(event) => onColorHexChange(event.target.value)}
            disabled={isSavingColor}
          />
          <input
            id="color-hex"
            className="min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-stone-900 focus-visible:border-[color:var(--color-matcha-500)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-matcha-200)]"
            value={colorHex}
            onChange={(event) => onColorHexChange(event.target.value)}
            placeholder="#RRGGBB（空欄で既定色）"
            disabled={isSavingColor}
          />
          <button
            type="button"
            className="flex min-h-11 items-center justify-center rounded-lg border border-stone-400 px-4 py-2 text-sm whitespace-nowrap text-stone-800 transition-colors duration-200 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onSaveColor}
            disabled={isSavingColor || colorHexError.length > 0}
          >
            <span>{isSavingColor ? "保存中..." : "保存"}</span>
          </button>
        </div>
        {colorHexError && <p className="mt-1 text-xs text-rose-600">{colorHexError}</p>}
      </div>
    </section>
  );
}
