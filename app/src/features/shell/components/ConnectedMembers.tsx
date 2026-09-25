import { useState } from "react";
import type { TeamMember } from "../../../contracts/models";
import { getReadableTextColor, resolveUserColor } from "../../../shared/utils/userColor";

type Props = {
  members: TeamMember[];
  userIds: string[];
  currentUserId: string | null;
  connected: boolean;
};
export function ConnectedMembers({ members, userIds, currentUserId, connected }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  if (!connected)
    return (
      <div role="status" className="mt-1 text-right text-xs text-stone-500">
        再接続中…
      </div>
    );
  const online = members.filter(
    (member) => member.userId !== currentUserId && userIds.includes(member.userId),
  );
  if (!online.length) return null;
  return (
    <div
      aria-label="接続中のチームメンバー"
      className="mt-2 flex flex-wrap items-center justify-end gap-2"
    >
      {online.map((member) => {
        const color = resolveUserColor(member.colorHex);
        const label = `${member.effectiveName}（接続中）`;
        return (
          <div key={member.userId} className="group relative">
            <button
              type="button"
              aria-label={label}
              aria-expanded={selected === member.userId}
              onClick={() => setSelected(selected === member.userId ? null : member.userId)}
              onBlur={() => setSelected(null)}
              className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-sm font-semibold ring-1 ring-green-600 focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ backgroundColor: color, color: getReadableTextColor(color) }}
            >
              {Array.from(member.effectiveName.trim())[0] ?? "?"}
            </button>
            <span
              className={`${selected === member.userId ? "block" : "hidden group-hover:block group-focus-within:block"} absolute right-0 top-full z-20 mt-1 whitespace-nowrap rounded-md bg-stone-800 px-2 py-1 text-xs text-white`}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
