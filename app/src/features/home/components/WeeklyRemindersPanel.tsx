import { CalendarDays } from "lucide-react";
import { Link } from "../../../shared/router/navigation";

import type { ReminderOccurrence } from "../../../lib/api/operations";
import { formatDateLabel } from "../../../shared/utils/dates";
import { HOME_PANEL_CLASS_NAME } from "./panelStyles";

type Props = {
  items: ReminderOccurrence[];
};

function reminderKindLabel(item: ReminderOccurrence) {
  switch (item.scheduleType) {
    case "daily":
      return "毎日";
    case "weekly":
      return "毎週";
    case "monthly":
      return "毎月";
    default:
      return "定期";
  }
}

export function WeeklyRemindersPanel({ items }: Props) {
  return (
    <article className={HOME_PANEL_CLASS_NAME}>
      <div className="flex items-center justify-between gap-2 px-2 md:px-0">
        <h2 className="text-lg font-semibold">今週のリマインダー</h2>
        <Link
          to="/calendar"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-2.5 py-1.5 text-sm font-medium text-body transition-colors hover:bg-surface-subtle hover:text-heading"
        >
          <CalendarDays size={16} aria-hidden="true" />
          <span>カレンダーへ</span>
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="mt-2 px-2 text-sm text-muted md:px-0">今週のリマインダーはありません。</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li key={`${item.reminderId}-${item.date}`}>
              <Link
                to={`/calendar?date=${item.date}`}
                className="flex min-h-11 items-start rounded-xl border border-line bg-surface px-3 py-2.5 transition-colors hover:bg-surface-subtle"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-heading">{item.title}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-secondary">
                    {item.kind === "recurring" ? (
                      <span className="inline-flex items-center rounded-full border border-line-strong bg-surface-subtle px-2 py-0.5 font-semibold text-body">
                        {reminderKindLabel(item)}
                      </span>
                    ) : null}
                    <span>{formatDateLabel(item.date)}</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
