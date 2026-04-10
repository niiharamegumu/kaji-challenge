import type {
  DayCellContentArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
} from "@fullcalendar/core";
import jaLocale from "@fullcalendar/core/locales/ja";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, {
  type DateClickArg,
} from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import { useAtom } from "jotai";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";

import type {
  CreateReminderRequest,
  Reminder,
  ReminderKind,
  ReminderOccurrence,
  ReminderScheduleType,
  UpdateReminderRequest,
} from "../../../lib/api/generated/client";
import {
  ReminderKind as ReminderKindConst,
  ReminderScheduleType as ReminderScheduleTypeConst,
} from "../../../lib/api/generated/client";
import { FooterQuickAction } from "../../../shared/components/FooterQuickAction";
import { FormSheet } from "../../../shared/components/FormSheet";
import { ConfirmModal } from "../../admin/components/ConfirmModal";
import { statusMessageAtom } from "../../shell/state/status";
import {
  useReminderCalendarQuery,
  useReminderDefinitionsQuery,
  useReminderMutations,
} from "../hooks/useReminders";
import {
  formatDateLabel,
  formatMonthLabel,
  monthKeyFromDateKey,
  normalizeDateKey,
  todayDateKey,
} from "../utils/date";

type ReminderFormState = {
  title: string;
  notes: string;
  kind: ReminderKind;
  scheduleType: ReminderScheduleType;
  startDate: string;
  endDate: string;
};

const calendarButtonClass =
  "flex h-10 w-10 items-center justify-center rounded-full border border-stone-300 bg-white text-stone-700 transition-colors hover:bg-stone-100";
const mobileDotIds = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
] as const;

function kindLabel(
  kind: ReminderKind,
  scheduleType?: ReminderScheduleType | null,
) {
  if (kind === ReminderKindConst.one_time) {
    return "1回だけ";
  }
  switch (scheduleType) {
    case ReminderScheduleTypeConst.daily:
      return "毎日";
    case ReminderScheduleTypeConst.weekly:
      return "毎週";
    case ReminderScheduleTypeConst.monthly:
      return "毎月";
    default:
      return "定期";
  }
}

function buildInitialFormState(selectedDate: string): ReminderFormState {
  return {
    title: "",
    notes: "",
    kind: ReminderKindConst.one_time,
    scheduleType: ReminderScheduleTypeConst.daily,
    startDate: selectedDate,
    endDate: "",
  };
}

function calendarDescription(isMobile: boolean) {
  return isMobile
    ? "未来の予定だけを表示します。日付変更は編集から行えます。"
    : "未来の予定だけを表示します。ドラッグで日付を変更できます。";
}

function toFormState(reminder: Reminder): ReminderFormState {
  return {
    title: reminder.title,
    notes: reminder.notes ?? "",
    kind: reminder.kind,
    scheduleType: reminder.scheduleType ?? ReminderScheduleTypeConst.daily,
    startDate: reminder.startDate,
    endDate: reminder.endDate ?? "",
  };
}

function ReminderSheet({
  isOpen,
  form,
  title,
  submitLabel,
  onChange,
  onClose,
  onDelete,
  onSubmit,
}: {
  isOpen: boolean;
  form: ReminderFormState;
  title: string;
  submitLabel: string;
  onChange: (next: ReminderFormState) => void;
  onClose: () => void;
  onDelete?: () => void;
  onSubmit: () => void;
}) {
  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  return (
    <FormSheet
      isOpen={isOpen}
      title={title}
      submitLabel={submitLabel}
      submitDisabled={form.title.trim() === "" || form.startDate === ""}
      onClose={onClose}
      onSubmit={onSubmit}
      footerStart={
        onDelete != null ? (
          <button
            type="button"
            className="inline-flex h-10 items-center gap-1 rounded-xl border border-rose-300 bg-rose-50 px-3 text-sm text-rose-700 transition-colors hover:bg-rose-100"
            onClick={onDelete}
          >
            <Trash2 size={15} aria-hidden="true" />
            <span>削除</span>
          </button>
        ) : null
      }
    >
      <ReminderFormFields form={form} onChange={onChange} />
    </FormSheet>
  );
}

function ReminderFormFields({
  form,
  onChange,
}: {
  form: ReminderFormState;
  onChange: (next: ReminderFormState) => void;
}) {
  const isRecurring = form.kind === ReminderKindConst.recurring;

  return (
    <div className="grid gap-3">
      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-stone-700">タイトル</span>
        <input
          className="h-11 rounded-xl border border-stone-300 bg-white px-3 text-sm"
          value={form.title}
          onChange={(event) => onChange({ ...form, title: event.target.value })}
        />
      </label>
      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-stone-700">メモ</span>
        <textarea
          className="min-h-24 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm"
          value={form.notes}
          onChange={(event) => onChange({ ...form, notes: event.target.value })}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-stone-700">種別</span>
          <select
            className="h-11 rounded-xl border border-stone-300 bg-white px-3 text-sm"
            value={form.kind}
            onChange={(event) =>
              onChange({
                ...form,
                kind: event.target.value as ReminderKind,
                endDate:
                  event.target.value === ReminderKindConst.one_time
                    ? ""
                    : form.endDate,
              })
            }
          >
            <option value={ReminderKindConst.one_time}>1回だけ</option>
            <option value={ReminderKindConst.recurring}>定期</option>
          </select>
        </label>
        {isRecurring ? (
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-stone-700">くり返し</span>
            <select
              className="h-11 rounded-xl border border-stone-300 bg-white px-3 text-sm"
              value={form.scheduleType}
              onChange={(event) =>
                onChange({
                  ...form,
                  scheduleType: event.target.value as ReminderScheduleType,
                })
              }
            >
              <option value={ReminderScheduleTypeConst.daily}>毎日</option>
              <option value={ReminderScheduleTypeConst.weekly}>毎週</option>
              <option value={ReminderScheduleTypeConst.monthly}>毎月</option>
            </select>
          </label>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className={`grid gap-1.5 ${!isRecurring ? "col-span-2" : ""}`}>
          <span className="text-sm font-medium text-stone-700">開始日</span>
          <input
            type="date"
            className="h-11 rounded-xl border border-stone-300 bg-white px-3 text-sm"
            value={form.startDate}
            onChange={(event) =>
              onChange({ ...form, startDate: event.target.value })
            }
          />
        </label>
        {isRecurring ? (
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-stone-700">終了日</span>
            <input
              type="date"
              className="h-11 rounded-xl border border-stone-300 bg-white px-3 text-sm"
              value={form.endDate}
              onChange={(event) =>
                onChange({ ...form, endDate: event.target.value })
              }
            />
          </label>
        ) : null}
      </div>
    </div>
  );
}

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false,
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const mediaQuery = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [breakpoint]);

  return isMobile;
}

function useViewportHeight() {
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight : 0,
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleResize = () => {
      setViewportHeight(window.innerHeight);
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return viewportHeight;
}

function ReminderAgendaList({
  selectedOccurrences,
  reminderMap,
  className,
  onEdit,
}: {
  selectedOccurrences: ReminderOccurrence[];
  reminderMap: Map<string, Reminder>;
  className?: string;
  onEdit: (reminder: Reminder, dateKey: string) => void;
}) {
  if (selectedOccurrences.length === 0) {
    return (
      <p className={className ?? "text-sm text-stone-500"}>
        この日のリマインダーはありません。
      </p>
    );
  }

  return (
    <ul className={className ?? "space-y-2"}>
      {selectedOccurrences.map((occurrence: ReminderOccurrence) => {
        const reminder = reminderMap.get(occurrence.reminderId);
        return (
          <li
            key={`${occurrence.reminderId}-${occurrence.date}`}
            className="rounded-xl border border-stone-200 bg-white px-3 py-2.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-stone-900">
                  {occurrence.title}
                </div>
                {occurrence.notes != null && occurrence.notes !== "" ? (
                  <div className="mt-1 whitespace-pre-wrap break-words text-xs text-stone-600">
                    {occurrence.notes}
                  </div>
                ) : null}
                <div className="mt-2 inline-flex items-center rounded-full border border-stone-300 bg-stone-50 px-2 py-0.5 text-xs text-stone-700">
                  {kindLabel(occurrence.kind, occurrence.scheduleType)}
                </div>
              </div>
              {reminder != null ? (
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 bg-white text-stone-700 transition-colors hover:bg-stone-100"
                  aria-label={`${occurrence.title} を編集`}
                  onClick={() => onEdit(reminder, occurrence.date)}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function MobileAgendaSheet({
  isOpen,
  dateLabel,
  selectedOccurrences,
  reminderMap,
  onClose,
  onEdit,
}: {
  isOpen: boolean;
  dateLabel: string;
  selectedOccurrences: ReminderOccurrence[];
  reminderMap: Map<string, Reminder>;
  onClose: () => void;
  onEdit: (reminder: Reminder, dateKey: string) => void;
}) {
  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[60] bg-stone-900/20"
        aria-label="選択日の詳細を閉じる"
        onClick={onClose}
      />
      <dialog
        open
        className="fixed bottom-2 left-1/2 z-[70] flex max-h-[calc(100dvh-1rem-env(safe-area-inset-top))] w-[min(42rem,calc(100%-1rem))] -translate-x-1/2 flex-col rounded-[1.75rem] border border-stone-200 bg-white px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 shadow-2xl"
        aria-modal="true"
        aria-label={`${dateLabel} のリマインダー`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarDays
              size={18}
              aria-hidden="true"
              className="text-stone-600"
            />
            <h3 className="text-base font-semibold text-stone-900">
              {dateLabel}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md px-2 py-1 text-sm text-stone-600 transition-colors hover:bg-stone-100"
              onClick={onClose}
            >
              閉じる
            </button>
          </div>
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          <ReminderAgendaList
            selectedOccurrences={selectedOccurrences}
            reminderMap={reminderMap}
            className={
              selectedOccurrences.length === 0
                ? "text-sm text-stone-500"
                : "space-y-2"
            }
            onEdit={onEdit}
          />
        </div>
      </dialog>
    </>,
    document.body,
  );
}

export function ReminderCalendarPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialDateParam = searchParams.get("date");
  const initialSelectedDate = normalizeDateKey(initialDateParam);
  const isMobile = useIsMobile();
  const viewportHeight = useViewportHeight();
  const [selectedDate, setSelectedDate] = useState(initialSelectedDate);
  const [mobileAgendaOpen, setMobileAgendaOpen] = useState(
    () => isMobile && initialDateParam != null,
  );
  const [visibleMonth, setVisibleMonth] = useState(
    monthKeyFromDateKey(initialSelectedDate),
  );
  const [sheetMode, setSheetMode] = useState<"create" | "edit" | null>(null);
  const [editingReminderId, setEditingReminderId] = useState<string | null>(
    null,
  );
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState(buildInitialFormState(initialSelectedDate));
  const [, setStatus] = useAtom(statusMessageAtom);
  const calendarRef = useRef<FullCalendar | null>(null);
  const definitionsQuery = useReminderDefinitionsQuery();
  const calendarQuery = useReminderCalendarQuery(visibleMonth);
  const { createReminder, updateReminder, removeReminder } =
    useReminderMutations(setStatus);

  const reminderMap = useMemo(
    () => new Map(definitionsQuery.data.map((item) => [item.id, item])),
    [definitionsQuery.data],
  );
  const calendarDays = useMemo(
    () => calendarQuery.data ?? [],
    [calendarQuery.data],
  );

  const occurrencesByDate = useMemo(() => {
    return new Map(calendarDays.map((day) => [day.date, day.items]));
  }, [calendarDays]);
  const occurrenceCountByDate = useMemo(
    () => new Map(calendarDays.map((day) => [day.date, day.items.length])),
    [calendarDays],
  );

  const selectedOccurrences = occurrencesByDate.get(selectedDate) ?? [];
  const canCreateOnSelectedDate = selectedDate >= todayDateKey();
  const quickActionDate = canCreateOnSelectedDate
    ? selectedDate
    : todayDateKey();
  const mobileCalendarHeight = isMobile
    ? Math.max(360, Math.min(viewportHeight - 300, 520))
    : undefined;
  const mobileMarkerLimit =
    mobileCalendarHeight == null || mobileCalendarHeight < 410
      ? 4
      : mobileCalendarHeight < 470
        ? 6
        : mobileCalendarHeight < 520
          ? 9
          : 12;
  const mobileDayHeight =
    mobileCalendarHeight == null
      ? "3.7rem"
      : mobileCalendarHeight >= 470
        ? "4.75rem"
        : mobileCalendarHeight >= 410
          ? "4.2rem"
          : "3.7rem";

  const events = useMemo(
    () =>
      calendarDays.flatMap((day) =>
        day.items.map((item) => ({
          id: `${item.reminderId}-${item.date}`,
          title: item.title,
          start: item.date,
          allDay: true,
          classNames: ["reminder-event"],
          extendedProps: {
            reminderId: item.reminderId,
            reminderDate: item.date,
            kind: item.kind,
            scheduleType: item.scheduleType,
          },
        })),
      ),
    [calendarDays],
  );

  const updateSelectedDate = (nextDate: string) => {
    setSelectedDate(nextDate);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("date", nextDate);
      return next;
    });
  };

  const openCreateSheet = (dateKey: string) => {
    updateSelectedDate(dateKey);
    setEditingReminderId(null);
    setForm(buildInitialFormState(dateKey));
    setSheetMode("create");
  };

  const openQuickActionCreateSheet = () => {
    openCreateSheet(quickActionDate);
  };

  const openEditSheet = (reminder: Reminder, dateKey: string) => {
    updateSelectedDate(dateKey);
    setEditingReminderId(reminder.id);
    setForm(toFormState(reminder));
    setSheetMode("edit");
  };

  const handleDateClick = (arg: DateClickArg) => {
    if (isMobile) {
      updateSelectedDate(arg.dateStr);
      setMobileAgendaOpen(true);
      return;
    }

    updateSelectedDate(arg.dateStr);
  };

  const renderDayCellContent = (arg: DayCellContentArg) => {
    const dateKey = arg.date.toLocaleDateString("sv-SE", {
      timeZone: "Asia/Tokyo",
    });
    const isSelected = dateKey === selectedDate;
    const occurrenceCount = occurrenceCountByDate.get(dateKey) ?? 0;
    const dayNumber = String(arg.date.getDate());
    const mobileDots = mobileDotIds.slice(
      0,
      Math.min(occurrenceCount, mobileMarkerLimit),
    );
    const canCreate = dateKey >= todayDateKey();

    return (
      <div
        className={`flex w-full flex-col items-center ${
          isMobile ? "h-full justify-between gap-0.5" : "items-stretch gap-1"
        }`}
      >
        {!isMobile ? (
          <div className="flex w-full items-start justify-between">
            {canCreate ? (
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center text-stone-500 transition-colors hover:text-stone-800"
                aria-label={`${formatDateLabel(dateKey)}に追加`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openCreateSheet(dateKey);
                }}
              >
                <Plus size={16} aria-hidden="true" strokeWidth={2.25} />
              </button>
            ) : (
              <span className="block h-7 w-7" aria-hidden="true" />
            )}
            <button
              type="button"
              className={`reminder-day-number inline-flex min-h-7 min-w-7 cursor-pointer items-center justify-center rounded-full px-1.5 text-xs font-medium transition-colors ${
                isSelected
                  ? "bg-amber-100 text-stone-900"
                  : "text-stone-700 hover:bg-stone-100"
              } ${arg.isOther ? "text-stone-400" : ""}`}
              aria-label={`${formatDateLabel(dateKey)}を選択`}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                updateSelectedDate(dateKey);
              }}
            >
              {dayNumber}
            </button>
          </div>
        ) : null}
        {isMobile ? (
          <button
            type="button"
            className={`reminder-day-number inline-flex min-w-7 cursor-pointer items-center justify-center rounded-full px-1.5 text-xs font-medium transition-colors ${
              isMobile ? "min-h-9 py-1.5" : "min-h-7"
            } ${
              isSelected
                ? "bg-amber-100 text-stone-900"
                : "text-stone-700 hover:bg-stone-100"
            } ${arg.isOther ? "text-stone-400" : ""}`}
            aria-label={`${formatDateLabel(dateKey)}を選択`}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              updateSelectedDate(dateKey);
              if (isMobile) {
                setMobileAgendaOpen(true);
              }
            }}
          >
            {dayNumber}
          </button>
        ) : null}
        {isMobile && occurrenceCount > 0 ? (
          <span
            className={`grid place-items-center gap-x-1 gap-y-0.5 ${
              mobileMarkerLimit >= 12
                ? "grid-cols-3"
                : mobileMarkerLimit >= 9
                  ? "grid-cols-3"
                  : mobileMarkerLimit >= 6
                    ? "grid-cols-3"
                    : "grid-cols-2"
            }`}
            aria-label={`リマインダー${occurrenceCount}件`}
          >
            {mobileDots.map((dotId) => (
              <span
                key={`${dateKey}-dot-${dotId}`}
                className="h-1.5 w-1.5 rounded-full bg-stone-900"
              />
            ))}
          </span>
        ) : null}
      </div>
    );
  };

  const handleEventClick = (arg: EventClickArg) => {
    const reminderId = String(arg.event.extendedProps.reminderId);
    const reminderDate = String(arg.event.extendedProps.reminderDate);
    const reminder = reminderMap.get(reminderId);
    if (reminder == null) {
      return;
    }
    openEditSheet(reminder, reminderDate);
  };

  const handleEventDrop = (arg: EventDropArg) => {
    const reminderId = String(arg.event.extendedProps.reminderId);
    const reminder = reminderMap.get(reminderId);
    if (reminder == null) {
      arg.revert();
      return;
    }
    const nextDate = arg.event.startStr.slice(0, 10);
    if (nextDate < todayDateKey()) {
      arg.revert();
      return;
    }
    void updateReminder
      .mutateAsync({
        reminderId,
        payload: { startDate: nextDate },
      })
      .catch(() => {
        arg.revert();
      });
  };

  const handleSubmit = () => {
    if (sheetMode == null) {
      return;
    }
    if (sheetMode === "create") {
      const payload: CreateReminderRequest = {
        title: form.title.trim(),
        notes: form.notes.trim() === "" ? undefined : form.notes.trim(),
        kind: form.kind,
        startDate: form.startDate,
        scheduleType:
          form.kind === ReminderKindConst.recurring
            ? form.scheduleType
            : undefined,
        endDate:
          form.kind === ReminderKindConst.recurring && form.endDate !== ""
            ? form.endDate
            : undefined,
      };
      void createReminder.mutateAsync(payload).then(() => {
        setSheetMode(null);
        if (isMobile) {
          setMobileAgendaOpen(true);
        }
      });
      return;
    }
    if (editingReminderId == null) {
      return;
    }
    const payload: UpdateReminderRequest = {
      title: form.title.trim(),
      notes: form.notes.trim() === "" ? null : form.notes.trim(),
      kind: form.kind,
      startDate: form.startDate,
      scheduleType:
        form.kind === ReminderKindConst.recurring ? form.scheduleType : null,
      endDate:
        form.kind === ReminderKindConst.recurring
          ? form.endDate === ""
            ? null
            : form.endDate
          : null,
    };
    void updateReminder
      .mutateAsync({ reminderId: editingReminderId, payload })
      .then(() => {
        setSheetMode(null);
      });
  };

  const renderEventContent = (arg: EventContentArg) => {
    const kind = String(arg.event.extendedProps.kind) as ReminderKind;
    const scheduleType = (arg.event.extendedProps.scheduleType ??
      null) as ReminderScheduleType | null;
    return (
      <div className="reminder-event-card overflow-hidden rounded-md border border-stone-200 bg-white px-1.5 py-1 text-[11px] leading-tight text-stone-800 shadow-sm">
        <div className="truncate font-medium">{arg.event.title}</div>
        <div className="mt-0.5 truncate text-[10px] text-stone-500">
          {kindLabel(kind, scheduleType)}
        </div>
      </div>
    );
  };

  return (
    <section className="mt-2 w-full pb-1 md:mt-4">
      <style>{`
        .reminder-calendar .fc .fc-highlight {
          background: transparent;
        }
        .reminder-calendar .fc .fc-scrollgrid {
          border: 0;
          border-collapse: separate;
          border-spacing: 0;
          border-radius: 1rem;
          overflow: hidden;
        }
        .reminder-calendar .fc-theme-standard td,
        .reminder-calendar .fc-theme-standard th {
          border-color: rgb(231 229 228);
        }
        .reminder-calendar .fc-theme-standard tr > :last-child {
          border-right: 0;
        }
        .reminder-calendar .fc-theme-standard tbody tr:last-child td {
          border-bottom: 0;
        }
        .reminder-calendar .fc .fc-daygrid-body-balanced .fc-daygrid-day-events {
          min-height: 0;
        }
        .reminder-calendar .fc .fc-daygrid-day.fc-day-today {
          background: rgb(254 249 195 / 0.55);
        }
        .reminder-calendar .fc .fc-daygrid-day.reminder-selected-day {
          background: rgb(250 245 235);
        }
        .reminder-calendar .fc .fc-daygrid-day-top {
          display: block;
        }
        .reminder-calendar .fc .fc-daygrid-day-number {
          display: block;
          padding: 0;
        }
        .reminder-calendar .fc .fc-daygrid-event {
          border: 0;
          background: transparent;
          box-shadow: none;
          margin: 0;
          cursor: pointer;
        }
        .reminder-calendar .fc .fc-event:focus,
        .reminder-calendar .fc .fc-event:focus-visible,
        .reminder-calendar .fc .fc-daygrid-event:focus,
        .reminder-calendar .fc .fc-daygrid-event:focus-visible {
          outline: none;
          box-shadow: none;
        }
        @media (max-width: 767px) {
          .reminder-calendar .fc .fc-col-header-cell-cushion {
            padding: 0.4rem 0;
            font-size: 0.95rem;
          }
          .reminder-calendar .fc .fc-daygrid-day-frame {
            min-height: var(--mobile-reminder-day-height, 3.55rem);
            padding: 0.2rem 0.15rem 0.15rem;
          }
          .reminder-calendar .fc .fc-daygrid-day-top {
            display: block;
          }
          .reminder-calendar .fc .fc-daygrid-day-number {
            padding: 0;
          }
          .reminder-calendar .reminder-day-number {
            width: 100%;
            border-radius: 0.9rem;
          }
          .reminder-calendar .fc .fc-daygrid-day-events {
            display: none;
          }
          .reminder-calendar .fc .fc-scrollgrid-section-header th {
            border-bottom: 1px solid rgb(231 229 228);
          }
        }
      `}</style>
      <article className="animate-enter rounded-xl border border-stone-200 bg-white/90 p-2.5 shadow-sm md:rounded-2xl md:p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">リマインダーカレンダー</h2>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              className={calendarButtonClass}
              onClick={() => calendarRef.current?.getApi().prev()}
              aria-label="前の月"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <h3 className="min-w-0 text-base font-semibold text-stone-900 md:text-lg">
              {formatMonthLabel(visibleMonth)}
            </h3>
            <button
              type="button"
              className={calendarButtonClass}
              onClick={() => calendarRef.current?.getApi().next()}
              aria-label="次の月"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100"
            onClick={() => {
              calendarRef.current?.getApi().today();
              updateSelectedDate(todayDateKey());
            }}
          >
            今日
          </button>
        </div>

        <div
          className="reminder-calendar relative mt-3 overflow-hidden rounded-2xl border border-stone-200 bg-[color:var(--color-washi-50)]"
          style={
            isMobile
              ? {
                  ["--mobile-reminder-day-height" as string]: mobileDayHeight,
                }
              : undefined
          }
        >
          <FullCalendar
            ref={calendarRef}
            locale={jaLocale}
            plugins={[dayGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            initialDate={selectedDate}
            headerToolbar={false}
            events={isMobile ? [] : events}
            editable
            dayMaxEventRows={3}
            height={
              isMobile && mobileCalendarHeight != null
                ? mobileCalendarHeight
                : "auto"
            }
            longPressDelay={250}
            eventDurationEditable={false}
            dateClick={handleDateClick}
            eventClick={handleEventClick}
            eventDrop={handleEventDrop}
            eventAllow={(dropInfo) =>
              dropInfo.startStr.slice(0, 10) >= todayDateKey()
            }
            dayCellContent={renderDayCellContent}
            dayCellClassNames={(arg) => {
              const dateKey = arg.date.toLocaleDateString("sv-SE", {
                timeZone: "Asia/Tokyo",
              });
              return dateKey === selectedDate ? ["reminder-selected-day"] : [];
            }}
            datesSet={(arg) => {
              const monthKey = arg.view.currentStart
                .toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })
                .slice(0, 7);
              if (monthKey !== visibleMonth) {
                setVisibleMonth(monthKey);
              }
            }}
            eventContent={renderEventContent}
          />
          {calendarQuery.isFetching ? (
            <div className="absolute inset-2 z-10 flex items-center justify-center rounded-[calc(1rem-2px)] bg-white/65 backdrop-blur-[1px]">
              <output
                className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-600 shadow-sm"
                aria-label="カレンダーを読み込み中"
              >
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-stone-300 border-t-stone-700 motion-reduce:animate-none" />
                <span>カレンダーを更新中</span>
              </output>
            </div>
          ) : null}
        </div>

        <section className="mt-4 hidden rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3 md:block">
          <div className="flex items-center gap-2">
            <CalendarDays
              size={18}
              aria-hidden="true"
              className="text-stone-600"
            />
            <h3 className="text-base font-semibold text-stone-900">
              {formatDateLabel(selectedDate)}
            </h3>
          </div>
          <ReminderAgendaList
            selectedOccurrences={selectedOccurrences}
            reminderMap={reminderMap}
            className={
              selectedOccurrences.length === 0
                ? "mt-3 text-sm text-stone-500"
                : "mt-3 space-y-2"
            }
            onEdit={openEditSheet}
          />
        </section>
        <p className="mt-4 text-xs text-stone-500">
          {calendarDescription(isMobile)}
        </p>
      </article>

      <MobileAgendaSheet
        isOpen={isMobile && mobileAgendaOpen}
        dateLabel={formatDateLabel(selectedDate)}
        selectedOccurrences={selectedOccurrences}
        reminderMap={reminderMap}
        onClose={() => setMobileAgendaOpen(false)}
        onEdit={openEditSheet}
      />

      <ReminderSheet
        isOpen={sheetMode === "edit"}
        form={form}
        title="リマインダーを編集"
        submitLabel="更新する"
        onChange={setForm}
        onClose={() => setSheetMode(null)}
        onDelete={
          sheetMode === "edit" && editingReminderId != null
            ? () => setPendingDeleteId(editingReminderId)
            : undefined
        }
        onSubmit={handleSubmit}
      />

      <FooterQuickAction
        isOpen={sheetMode === "create"}
        title="リマインダーを追加"
        submitLabel="追加する"
        submitDisabled={form.title.trim() === "" || form.startDate === ""}
        onOpen={openQuickActionCreateSheet}
        onClose={() => setSheetMode(null)}
        onSubmit={handleSubmit}
      >
        <ReminderFormFields form={form} onChange={setForm} />
      </FooterQuickAction>

      <ConfirmModal
        isOpen={pendingDeleteId != null}
        title="リマインダーを削除しますか"
        message="このリマインダー定義を削除します。定期リマインダーの場合は今後の表示も消えます。"
        confirmLabel="削除する"
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteId == null) {
            return;
          }
          void removeReminder.mutateAsync(pendingDeleteId).then(() => {
            setPendingDeleteId(null);
            setSheetMode(null);
          });
        }}
      />
    </section>
  );
}
