import { Check, Copy, LogIn, Send } from "lucide-react";
import { useEffect, useState } from "react";

type Props = {
  inviteCode: string;
  joinCode: string;
  isCreatingInvite: boolean;
  isJoiningTeam: boolean;
  onJoinCodeChange: (value: string) => void;
  onCreateInvite: () => void;
  onJoinTeam: () => void;
};

export function InviteManager({
  inviteCode,
  joinCode,
  isCreatingInvite,
  isJoiningTeam,
  onJoinCodeChange,
  onCreateInvite,
  onJoinTeam,
}: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCopied(false);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopyInviteCode = async () => {
    if (!inviteCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = inviteCode;
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
    <article className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm animate-enter md:p-6">
      <h2 className="text-lg font-semibold">招待管理</h2>
      <div className="mt-4 grid gap-3">
        <button
          type="button"
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[color:var(--color-matcha-600)] px-3 py-2 text-white transition-colors duration-200 hover:bg-[color:var(--color-matcha-700)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-fit sm:px-4"
          onClick={onCreateInvite}
          disabled={isCreatingInvite}
        >
          <Send size={16} aria-hidden="true" />
          <span>{isCreatingInvite ? "発行中..." : "招待コード発行"}</span>
        </button>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
          <span>発行コード:</span>
          <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] tracking-wide">
            {inviteCode || "未発行"}
          </code>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-600 transition-colors duration-200 hover:bg-stone-100 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => {
              void handleCopyInviteCode();
            }}
            disabled={!inviteCode}
            aria-label={
              copied ? "招待コードをコピー済み" : "招待コードをコピー"
            }
            title={copied ? "コピー済み" : "コピー"}
          >
            {copied ? (
              <Check size={14} aria-hidden="true" />
            ) : (
              <Copy size={14} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <div className="mt-5 border-t border-stone-200 pt-5">
        <label className="text-sm text-stone-700" htmlFor="join-code">
          招待コード
        </label>
        <div className="mt-3 flex gap-2">
          <input
            id="join-code"
            className="min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 focus-visible:border-[color:var(--color-matcha-500)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-matcha-200)]"
            value={joinCode}
            onChange={(event) => onJoinCodeChange(event.target.value)}
            placeholder="招待コード入力"
            disabled={isJoiningTeam}
          />
          <button
            type="button"
            className="flex min-h-11 items-center gap-2 rounded-lg border border-stone-400 px-3 py-2 whitespace-nowrap transition-colors duration-200 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onJoinTeam}
            disabled={isJoiningTeam || joinCode.trim().length === 0}
          >
            <LogIn size={14} aria-hidden="true" />
            <span>{isJoiningTeam ? "参加中..." : "参加"}</span>
          </button>
        </div>
      </div>
    </article>
  );
}
