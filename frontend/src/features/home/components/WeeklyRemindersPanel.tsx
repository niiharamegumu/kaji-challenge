import { CalendarDays } from "lucide-react";
import { Link } from "react-router-dom";

import type { ReminderOccurrence } from "../../../lib/api/generated/client";
import { formatDateLabel } from "../../reminders/utils/date";
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
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-stone-300 bg-white px-2.5 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 hover:text-stone-900"
        >
          <CalendarDays size={16} aria-hidden="true" />
          <span>カレンダーへ</span>
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="mt-2 px-2 text-sm text-stone-500 md:px-0">
          今週のリマインダーはありません。
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li key={`${item.reminderId}-${item.date}`}>
              <Link
                to={`/calendar?date=${item.date}`}
                className="flex min-h-11 items-start rounded-xl border border-stone-200 bg-white px-3 py-2.5 transition-colors hover:bg-stone-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-stone-900">
                    {item.title}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-stone-600">
                    {item.kind === "recurring" ? (
                      <span className="inline-flex items-center rounded-full border border-stone-300 bg-stone-50 px-2 py-0.5 font-semibold text-stone-700">
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
