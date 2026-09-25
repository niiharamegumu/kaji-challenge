import { useId, useState } from "react";
import type { TeamMember } from "../../../contracts/models";
import { getReadableTextColor, resolveUserColor } from "../../../shared/utils/userColor";

type Props = {
  members: TeamMember[];
  userIds: string[];
  connected: boolean;
};
type OpenPanel = { kind: "member"; userId: string } | { kind: "all" } | null;

function MemberAvatar({ member, online }: { member: TeamMember; online: boolean }) {
  const color = resolveUserColor(member.colorHex);
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-white text-xs font-semibold ${online ? "" : "ring-1 ring-stone-300 grayscale-[0.7] opacity-60"}`}
      style={{ backgroundColor: color, color: getReadableTextColor(color) }}
    >
      {Array.from(member.effectiveName.trim())[0] ?? "?"}
    </span>
  );
}

export function ConnectedMembers({ members, userIds, connected }: Props) {
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const panelId = useId();
  if (!members.length) return null;
  // 自分の接続が切れたときは、古いpresenceを使って他の人を接続中と表示しない。
  const memberStates = members.map((member) => {
    const online = connected && userIds.includes(member.userId);
    const status = !connected ? "接続確認中" : online ? "接続中" : "未接続";
    return { member, online, label: `${member.effectiveName}（${status}）` };
  });
  const remainingCount = members.length - 2;
  return (
    <div
      aria-label="チームメンバー"
      className="relative flex h-10 shrink-0 items-center -space-x-3"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpenPanel(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpenPanel(null);
      }}
    >
      {memberStates.slice(0, 2).map(({ member, online, label }, index) => {
        const isOpen = openPanel?.kind === "member" && openPanel.userId === member.userId;
        const tooltipId = `${panelId}-member-${index}`;
        return (
          <div
            key={member.userId}
            onMouseEnter={() => setOpenPanel({ kind: "member", userId: member.userId })}
            onMouseLeave={(event) => {
              if (!event.currentTarget.contains(document.activeElement)) setOpenPanel(null);
            }}
          >
            <button
              type="button"
              aria-label={label}
              aria-expanded={isOpen}
              aria-describedby={isOpen ? tooltipId : undefined}
              onFocus={() => setOpenPanel({ kind: "member", userId: member.userId })}
              onClick={() => setOpenPanel({ kind: "member", userId: member.userId })}
              className="flex h-10 w-9 items-start justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 md:items-center"
            >
              <MemberAvatar member={member} online={online} />
            </button>
            {isOpen ? (
              <span
                id={tooltipId}
                role="tooltip"
                className="absolute right-0 top-full z-20 mt-1 w-max max-w-[min(20rem,calc(100vw-2rem))] rounded-md bg-stone-800 px-2 py-1 text-xs break-words text-white"
              >
                {label}
              </span>
            ) : null}
          </div>
        );
      })}
      {remainingCount > 0 ? (
        <div>
          <button
            type="button"
            aria-label={`ほか${remainingCount}人：チームメンバー全${members.length}人を表示`}
            aria-expanded={openPanel?.kind === "all"}
            aria-controls={`${panelId}-all`}
            onClick={() => setOpenPanel(openPanel?.kind === "all" ? null : { kind: "all" })}
            className="flex h-10 w-9 items-start justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 md:items-center"
          >
            <span className="flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-white bg-stone-200 px-1 text-xs font-semibold text-stone-700">
              +{remainingCount}
            </span>
          </button>
          {openPanel?.kind === "all" ? (
            <ul
              id={`${panelId}-all`}
              aria-label="チームメンバー一覧"
              className="absolute right-0 top-full z-20 mt-1 max-h-60 w-max max-w-[min(20rem,calc(100vw-2rem))] space-y-2 overflow-y-auto rounded-md border border-stone-200 bg-white p-3 text-xs shadow-lg"
            >
              {memberStates.map(({ member, online, label }) => (
                <li key={member.userId} className="flex items-center gap-2">
                  <MemberAvatar member={member} online={online} />
                  <span className="min-w-0 break-words">{label}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {!connected ? (
        <span role="status" className="sr-only">
          再接続中…
        </span>
      ) : null}
    </div>
  );
}
