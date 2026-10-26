import { queryOptions } from "@tanstack/react-query";
import { listReminderDefinitions, listReminders } from "../../lib/api/operations";
import { monthEndDateKey, monthStartDateKey } from "../utils/dates";
import { queryKeys } from "./queryKeys";

export const reminderDefinitionsQueryOptions = queryOptions({
  queryKey: queryKeys.reminderDefinitions,
  queryFn: async ({ signal }) => (await listReminderDefinitions({ signal })).data.items,
});

export const reminderCalendarQueryOptions = (monthKey: string) =>
  queryOptions({
    queryKey: [...queryKeys.reminders, monthKey],
    queryFn: async ({ signal }) =>
      (
        await listReminders(
          { from: monthStartDateKey(monthKey), to: monthEndDateKey(monthKey) },
          { signal },
        )
      ).data.days,
  });
