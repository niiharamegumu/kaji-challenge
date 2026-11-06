import { dateKeySchema, summaryMonthSchema } from "../../contracts/operations";

export function resolveCalendarDate(value: string | null, today: string): string {
  const parsed = dateKeySchema.safeParse(value);
  return parsed.success && parsed.data.slice(0, 7) >= today.slice(0, 7) ? parsed.data : today;
}

export function resolveSummaryMonth(value: string | null, today: string): string {
  return summaryMonthSchema.safeParse(value).data ?? today.slice(0, 7);
}
