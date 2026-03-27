import { CalendarDays, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

import type { ReminderOccurrence } from "../../../lib/api/generated/client";
import { formatDateLabel } from "../../reminders/utils/date";

type Props = {
  items: ReminderOccurrence[];
};

function reminderKindLabel(item: ReminderOccurrence) {
  if (item.kind === "one_time") {
    return "1回だけ";
  }
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
    <article className="animate-enter rounded-xl border border-stone-200 bg-white/90 p-2.5 shadow-sm md:rounded-2xl md:p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">今週のリマインダー</h2>
        <Link
          to="/calendar"
          className="inline-flex items-center gap-1 text-sm text-stone-700 underline underline-offset-4 transition-colors hover:text-stone-900"
        >
          <span>カレンダーへ</span>
          <ChevronRight size={14} aria-hidden="true" />
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">
          今週のリマインダーはありません。
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li key={`${item.reminderId}-${item.date}`}>
              <Link
                to={`/calendar?date=${item.date}`}
                className="flex min-h-11 items-start gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5 transition-colors hover:bg-stone-50"
              >
                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-700">
                  <CalendarDays size={16} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-stone-900">
                    {item.title}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-stone-600">
                    <span className="inline-flex items-center rounded-full border border-stone-300 bg-stone-50 px-2 py-0.5 font-semibold text-stone-700">
                      {reminderKindLabel(item)}
                    </span>
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
