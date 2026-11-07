import { Bell, Check, CircleCheck, Monitor, Palette, UserRound, UsersRound } from "lucide-react";

export const SETTINGS_CATEGORIES = [
  {
    id: "profile",
    label: "プロフィール",
    Icon: UserRound,
  },
  {
    id: "appearance",
    label: "表示",
    Icon: Palette,
  },
  {
    id: "todos",
    label: "ToDo",
    Icon: CircleCheck,
  },
  {
    id: "notifications",
    label: "通知",
    Icon: Bell,
  },
  {
    id: "team",
    label: "チーム",
    Icon: UsersRound,
  },
  {
    id: "app",
    label: "アプリ",
    Icon: Monitor,
  },
] as const;

export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]["id"];

export function SettingsNavigation({
  activeCategory,
  onSelect,
}: {
  activeCategory: SettingsCategory;
  onSelect: (category: SettingsCategory) => void;
}) {
  return (
    <nav
      aria-label="設定カテゴリー"
      className="grid grid-cols-3 gap-1.5 rounded-2xl border border-line bg-surface-subtle p-2 lg:sticky lg:top-[calc(env(safe-area-inset-top)+7rem)] lg:grid-cols-1 lg:self-start lg:border-0 lg:bg-transparent lg:p-0"
    >
      {SETTINGS_CATEGORIES.map(({ id, label, Icon }) => {
        const active = activeCategory === id;
        return (
          <button
            key={id}
            type="button"
            aria-label={`${label}の設定`}
            aria-pressed={active}
            aria-controls={`settings-${id}`}
            onClick={() => onSelect(id)}
            className={`relative flex min-h-14 min-w-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border px-1 py-2 text-xs font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:text-sm lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:py-3 ${active ? "border-accent/30 bg-success-soft text-success shadow-sm" : "border-transparent text-secondary hover:bg-surface-muted hover:text-heading"}`}
          >
            <Icon size={18} aria-hidden="true" className="shrink-0" />
            <span className="min-w-0 whitespace-nowrap lg:flex-1 lg:text-left">{label}</span>
            {active ? (
              <Check
                size={14}
                aria-hidden="true"
                className="absolute top-1.5 right-1.5 shrink-0 lg:static"
              />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
