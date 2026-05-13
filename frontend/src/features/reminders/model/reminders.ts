import type {
  CreateReminderRequest,
  Reminder,
  ReminderKind,
  ReminderScheduleType,
  UpdateReminderRequest,
} from "../../../lib/api/generated/client";
import {
  ReminderKind as GeneratedReminderKind,
  ReminderScheduleType as GeneratedReminderScheduleType,
} from "../../../lib/api/generated/client";

export type ReminderFormState = {
  title: string;
  notes: string;
  kind: ReminderKind;
  scheduleType: ReminderScheduleType;
  startDate: string;
  endDate: string;
};

export const ReminderKindConst = GeneratedReminderKind;
export const ReminderScheduleTypeConst = GeneratedReminderScheduleType;

export function kindLabel(
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

export function buildInitialFormState(selectedDate: string): ReminderFormState {
  return {
    title: "",
    notes: "",
    kind: ReminderKindConst.one_time,
    scheduleType: ReminderScheduleTypeConst.daily,
    startDate: selectedDate,
    endDate: "",
  };
}

export function toFormState(reminder: Reminder): ReminderFormState {
  return {
    title: reminder.title,
    notes: reminder.notes ?? "",
    kind: reminder.kind,
    scheduleType: reminder.scheduleType ?? ReminderScheduleTypeConst.daily,
    startDate: reminder.startDate,
    endDate: reminder.endDate ?? "",
  };
}

export function buildCreateReminderRequest(
  form: ReminderFormState,
): CreateReminderRequest {
  return {
    title: form.title.trim(),
    notes: form.notes.trim() === "" ? undefined : form.notes.trim(),
    kind: form.kind,
    startDate: form.startDate,
    scheduleType: isRecurringReminder(form) ? form.scheduleType : undefined,
    endDate:
      isRecurringReminder(form) && form.endDate !== ""
        ? form.endDate
        : undefined,
  };
}

export function buildUpdateReminderRequest(
  form: ReminderFormState,
): UpdateReminderRequest {
  return {
    title: form.title.trim(),
    notes: form.notes.trim() === "" ? null : form.notes.trim(),
    kind: form.kind,
    startDate: form.startDate,
    scheduleType: isRecurringReminder(form) ? form.scheduleType : null,
    endDate: isRecurringReminder(form)
      ? form.endDate === ""
        ? null
        : form.endDate
      : null,
  };
}

export function isRecurringReminder(form: ReminderFormState) {
  return form.kind === ReminderKindConst.recurring;
}
