import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
  usePrefetchQuery,
} from "@tanstack/react-query";

import {
  type CreateReminderRequest,
  deleteReminder,
  patchReminder,
  postReminder,
  type Reminder,
  type UpdateReminderRequest,
} from "../../../lib/api/operations";
import { queryKeys } from "../../../shared/query/queryKeys";
import { formatError } from "../../../shared/utils/errors";
import {
  reminderDefinitionsQueryOptions,
  reminderCalendarQueryOptions,
} from "../../../shared/query/reminderQueries";
export {
  reminderDefinitionsQueryOptions,
  reminderCalendarQueryOptions,
} from "../../../shared/query/reminderQueries";

type StatusSetter = (message: string) => void;

export function useReminderDefinitionsQuery() {
  return useSuspenseQuery(reminderDefinitionsQueryOptions);
}

export function useReminderCalendarQuery(monthKey: string) {
  return useQuery({
    ...reminderCalendarQueryOptions(monthKey),
    placeholderData: keepPreviousData,
  });
}

export function useReminderPageQueries(monthKey: string) {
  // Start occurrences even when definitions suspend this render. Month changes still
  // use the observer below to retain the previous data and its error/loading state.
  usePrefetchQuery(reminderCalendarQueryOptions(monthKey));
  const definitionsQuery = useReminderDefinitionsQuery();
  const calendarQuery = useReminderCalendarQuery(monthKey);
  return { definitionsQuery, calendarQuery };
}

export function useReminderMutations(setStatus: StatusSetter) {
  const queryClient = useQueryClient();

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.reminders }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.reminderDefinitions,
      }),
      queryClient.invalidateQueries({ queryKey: queryKeys.home }),
    ]);
  };

  const createReminder = useMutation({
    mutationFn: async (payload: CreateReminderRequest) => postReminder(payload),
    onSuccess: async ({ data }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.reminderDefinitions });
      queryClient.setQueryData<Reminder[]>(queryKeys.reminderDefinitions, (items) =>
        sortRemindersByDate([...(items ?? []), data]),
      );
      setStatus("リマインダーを追加しました");
      void invalidate();
    },
    onError: async (error) => {
      setStatus(`リマインダーの追加に失敗しました: ${formatError(error)}`);
    },
  });

  const updateReminder = useMutation({
    mutationFn: async ({
      reminderId,
      payload,
    }: {
      reminderId: string;
      payload: UpdateReminderRequest;
    }) => patchReminder(reminderId, payload),
    onSuccess: async ({ data }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.reminderDefinitions });
      queryClient.setQueryData<Reminder[]>(
        queryKeys.reminderDefinitions,
        (items) =>
          items && sortRemindersByDate(items.map((item) => (item.id === data.id ? data : item))),
      );
      setStatus("リマインダーを更新しました");
      void invalidate();
    },
    onError: async (error) => {
      setStatus(`リマインダーの更新に失敗しました: ${formatError(error)}`);
    },
  });

  const removeReminder = useMutation({
    mutationFn: async (reminderId: string) => deleteReminder(reminderId),
    onSuccess: async (_, reminderId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.reminderDefinitions });
      queryClient.setQueryData<Reminder[]>(queryKeys.reminderDefinitions, (items) =>
        items?.filter((item) => item.id !== reminderId),
      );
      setStatus("リマインダーを削除しました");
      void invalidate();
    },
    onError: async (error) => {
      setStatus(`リマインダーの削除に失敗しました: ${formatError(error)}`);
    },
  });

  return {
    createReminder,
    updateReminder,
    removeReminder,
  };
}

export function sortRemindersByDate(reminders: Reminder[]) {
  return [...reminders].sort((a, b) => {
    if (a.startDate === b.startDate) {
      return a.createdAt.localeCompare(b.createdAt);
    }
    return a.startDate.localeCompare(b.startDate);
  });
}
