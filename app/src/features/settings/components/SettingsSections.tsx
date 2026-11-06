import { Check, Copy, RefreshCw } from "lucide-react";

import type { TeamMember } from "../../../lib/api/operations";
import { getReadableTextColor, resolveUserColor } from "../../../shared/utils/userColor";
import type { InviteState } from "../model/invite";
import { formatDateTime } from "./settingsUtils";

const SETTINGS_PRIMARY_BUTTON_CLASS_NAME =
  "min-h-11 cursor-pointer rounded-lg bg-action px-4 py-2 text-sm whitespace-nowrap text-on-action transition-colors duration-200 hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60";

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
      <h3 className="text-sm font-semibold text-heading">チーム名</h3>
      <div>
        <label className="sr-only" htmlFor="team-name">
          チーム名
        </label>
        <div className="mt-2 flex items-center gap-2">
          <input
            id="team-name"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-heading focus-visible:border-[color:var(--color-matcha-500)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-matcha-200)]"
            value={teamName}
            onChange={(event) => onTeamNameChange(event.target.value)}
            placeholder="チーム名"
            disabled={isSavingTeamName}
          />
          <button
            type="button"
            className={SETTINGS_PRIMARY_BUTTON_CLASS_NAME}
            onClick={onSaveTeamName}
            disabled={isSavingTeamName || teamNameError.length > 0}
          >
            {isSavingTeamName ? "保存中..." : "保存"}
          </button>
        </div>
        {teamNameError && <p className="mt-1 text-xs text-danger">{teamNameError}</p>}
      </div>
    </section>
  );
}

type TeamMembersSectionProps = {
  members: TeamMember[];
};

export function TeamMembersSection({ members }: TeamMembersSectionProps) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-heading">
        チームメンバー
        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-normal text-secondary">
          {members.length}人
        </span>
      </h3>
      <ul className="space-y-2">
        {members.map((member) => (
          <li
            key={member.userId}
            className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 rounded-lg border border-line bg-surface-subtle px-3 py-2 text-sm"
          >
            <span className="rounded bg-surface px-2 py-0.5 text-center text-xs text-secondary">
              {member.role === "owner" ? "管理者" : "メンバー"}
            </span>
            <span
              className="min-w-0 max-w-full justify-self-start rounded px-2 py-0.5 font-medium wrap-anywhere"
              style={{
                backgroundColor: resolveUserColor(member.colorHex),
                color: getReadableTextColor(resolveUserColor(member.colorHex)),
              }}
            >
              {member.effectiveName}
            </span>
          </li>
        ))}
        {members.length === 0 && (
          <li className="rounded-lg border border-line bg-surface-subtle px-3 py-2 text-sm text-muted">
            メンバー情報がありません
          </li>
        )}
      </ul>
    </section>
  );
}

export function LeaveTeamSection({
  isLeavingTeam,
  onLeaveTeam,
}: {
  isLeavingTeam: boolean;
  onLeaveTeam: () => void;
}) {
  return (
    <div className="rounded-lg border border-danger-line bg-danger-soft/70 p-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <p className="text-xs text-danger">離脱すると新しいチームを作成します。</p>
        <button
          type="button"
          className="min-h-11 w-full cursor-pointer rounded-lg border border-danger-line px-4 py-2 text-sm text-danger transition-colors duration-200 hover:bg-danger-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:cursor-not-allowed disabled:opacity-60 xl:w-auto xl:shrink-0"
          onClick={onLeaveTeam}
          disabled={isLeavingTeam}
        >
          {isLeavingTeam ? "処理中..." : "離脱して新しいチームを作成"}
        </button>
      </div>
    </div>
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
      <h3 className="text-sm font-semibold text-heading">招待コード</h3>
      <p className="text-xs leading-relaxed text-secondary">
        一緒に家事をする人にコードを共有して、チームへ招待できます。
      </p>
      <div className="flex flex-wrap items-center gap-1.5 text-sm text-ink">
        <span>コード:</span>
        <code className="min-w-0 rounded bg-surface-muted px-2.5 py-2 font-mono text-sm tracking-wider break-all">
          {invite?.code ?? "未発行"}
        </code>
        <button
          type="button"
          className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line text-secondary transition-colors duration-200 hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onCopyInviteCode}
          disabled={!invite?.code}
          aria-label={copied ? "招待コードをコピー済み" : "招待コードをコピー"}
          title={copied ? "コピー済み" : "コピー"}
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line px-3 text-xs text-secondary transition-colors duration-200 hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onCreateInvite}
          disabled={isCreatingInvite}
          aria-label={isCreatingInvite ? "招待コードを発行中" : "招待コードを発行"}
          title={isCreatingInvite ? "発行中..." : "招待コード発行"}
        >
          <RefreshCw
            size={14}
            aria-hidden="true"
            className={isCreatingInvite ? "animate-spin" : undefined}
          />
          {isCreatingInvite ? "発行中…" : invite ? "再発行" : "コードを発行"}
        </button>
      </div>
      <p className="text-sm text-secondary">
        有効期限: {invite?.expiresAt ? formatDateTime(invite.expiresAt) : "-"}
      </p>
      {inviteExpired && (
        <p className="text-sm text-danger">この招待コードは期限切れです。再発行してください。</p>
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
      <h3 className="text-sm font-semibold text-heading">チーム参加</h3>
      <label className="sr-only" htmlFor="join-code">
        招待コード
      </label>
      <div>
        <div className="mt-2 flex items-center gap-2">
          <input
            id="join-code"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-heading focus-visible:border-[color:var(--color-matcha-500)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-matcha-200)]"
            value={joinCode}
            onChange={(event) => onJoinCodeChange(event.target.value)}
            placeholder="招待コード入力"
            disabled={isJoiningTeam}
          />
          <button
            type="button"
            className={`flex items-center justify-center ${SETTINGS_PRIMARY_BUTTON_CLASS_NAME}`}
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
    <section className="space-y-6">
      <div className="flex items-center gap-3 rounded-xl bg-surface-subtle p-4">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-semibold"
          aria-hidden="true"
          style={{
            backgroundColor: resolveUserColor(colorHex),
            color: getReadableTextColor(resolveUserColor(colorHex)),
          }}
        >
          {Array.from(nickname.trim())[0] || "あ"}
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted">表示イメージ</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-heading">
            {nickname.trim() || "あなたの名前"}
          </p>
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-heading">ニックネーム</h3>
        <p className="mt-1 text-xs text-muted">空欄で保存すると、アカウントの名前を使用します。</p>
        <label className="sr-only" htmlFor="nickname">
          ニックネーム
        </label>
        <div className="mt-2 flex w-full items-center gap-2">
          <input
            id="nickname"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-heading focus-visible:border-[color:var(--color-matcha-500)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-matcha-200)]"
            value={nickname}
            onChange={(event) => onNicknameChange(event.target.value)}
            placeholder="チームで使う名前"
            disabled={isSavingNickname}
          />
          <button
            type="button"
            className={`flex items-center justify-center ${SETTINGS_PRIMARY_BUTTON_CLASS_NAME}`}
            onClick={onSaveNickname}
            disabled={isSavingNickname || nicknameError.length > 0}
          >
            <span>{isSavingNickname ? "保存中..." : "保存"}</span>
          </button>
        </div>
        {nicknameError && <p className="mt-1 text-xs text-danger">{nicknameError}</p>}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-heading">表示カラー</h3>
        <p className="mt-1 text-xs text-muted">
          家事の担当者や完了した人の目印になります。空欄で既定色に戻せます。
        </p>
        <label className="sr-only" htmlFor="color-hex">
          表示カラー
        </label>
        <div className="mt-2 flex w-full items-center gap-2">
          <input
            id="color-picker"
            type="color"
            aria-label="表示カラーを選択"
            className="h-11 w-11 shrink-0 cursor-pointer rounded-lg border border-line-strong bg-surface p-1"
            value={resolveUserColor(colorHex)}
            onChange={(event) => onColorHexChange(event.target.value)}
            disabled={isSavingColor}
          />
          <input
            id="color-hex"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 font-mono text-heading focus-visible:border-[color:var(--color-matcha-500)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-matcha-200)]"
            value={colorHex}
            onChange={(event) => onColorHexChange(event.target.value)}
            placeholder="#RRGGBB"
            disabled={isSavingColor}
          />
          <button
            type="button"
            className={`flex items-center justify-center ${SETTINGS_PRIMARY_BUTTON_CLASS_NAME}`}
            onClick={onSaveColor}
            disabled={isSavingColor || colorHexError.length > 0}
          >
            <span>{isSavingColor ? "保存中..." : "保存"}</span>
          </button>
        </div>
        {colorHexError && <p className="mt-1 text-xs text-danger">{colorHexError}</p>}
      </div>
    </section>
  );
}
