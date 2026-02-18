import { LogIn, Send } from "lucide-react";

type Props = {
  inviteCode: string;
  joinCode: string;
  onJoinCodeChange: (value: string) => void;
  onCreateInvite: () => void;
  onJoinTeam: () => void;
};

export function InviteManager({
  inviteCode,
  joinCode,
  onJoinCodeChange,
  onCreateInvite,
  onJoinTeam,
}: Props) {
  return (
    <article className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm animate-enter">
      <h2 className="text-lg font-semibold">招待管理</h2>
      <div className="mt-4 rounded-xl border border-stone-200 p-3">
        <button
          type="button"
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[color:var(--color-matcha-600)] px-3 py-2 text-white"
          onClick={onCreateInvite}
        >
          <Send size={16} aria-hidden="true" />
          <span>招待コード発行</span>
        </button>
        <p className="mt-2 text-sm">発行コード: {inviteCode || "未発行"}</p>
        <label className="text-sm text-stone-700" htmlFor="join-code">
          招待コード
        </label>
        <div className="mt-3 flex gap-2">
          <input
            id="join-code"
            className="w-full rounded-lg border border-stone-300 px-3 py-2"
            value={joinCode}
            onChange={(event) => onJoinCodeChange(event.target.value)}
            placeholder="招待コード入力"
          />
          <button
            type="button"
            className="flex min-h-11 items-center gap-2 rounded-lg border border-stone-400 px-3 py-2 whitespace-nowrap"
            onClick={onJoinTeam}
          >
            <LogIn size={14} aria-hidden="true" />
            <span>参加</span>
          </button>
        </div>
      </div>
    </article>
  );
}
