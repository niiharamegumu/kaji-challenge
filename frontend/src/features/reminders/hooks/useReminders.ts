import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import {
  type CreateReminderRequest,
  type Reminder,
  type UpdateReminderRequest,
  deleteReminder,
  listReminderDefinitions,
  listReminders,
  patchReminder,
  postReminder,
} from "../../../lib/api/generated/client";
import { queryKeys } from "../../../shared/query/queryKeys";
import {
  formatError,
  isPreconditionFailure,
} from "../../../shared/utils/errors";
import { monthEndDateKey, monthStartDateKey } from "../utils/date";

type StatusSetter = (message: string) => void;

export function useReminderDefinitionsQuery() {
  return useSuspenseQuery({
    queryKey: queryKeys.reminderDefinitions,
    queryFn: async () => (await listReminderDefinitions()).data.items ?? [],
  });
}

export function useReminderCalendarQuery(monthKey: string) {
  return useQuery({
    queryKey: [...queryKeys.reminders, monthKey],
    queryFn: async () =>
      (
        await listReminders({
          from: monthStartDateKey(monthKey),
          to: monthEndDateKey(monthKey),
        })
      ).data.days ?? [],
    placeholderData: keepPreviousData,
  });
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

  const handlePrecondition = async (error: unknown) => {
    if (!isPreconditionFailure(error)) {
      return false;
    }
    await invalidate();
    setStatus(
      "他メンバーの更新を検知しました。最新状態に更新したので、もう一度操作してください。",
    );
    return true;
  };

  const createReminder = useMutation({
    mutationFn: async (payload: CreateReminderRequest) => postReminder(payload),
    onSuccess: async () => {
      setStatus("リマインダーを追加しました");
      await invalidate();
    },
    onError: (error) => {
      void handlePrecondition(error);
      if (isPreconditionFailure(error)) {
        return;
      }
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
    onSuccess: async () => {
      setStatus("リマインダーを更新しました");
      await invalidate();
    },
    onError: (error) => {
      void handlePrecondition(error);
      if (isPreconditionFailure(error)) {
        return;
      }
      setStatus(`リマインダーの更新に失敗しました: ${formatError(error)}`);
    },
  });

  const removeReminder = useMutation({
    mutationFn: async (reminderId: string) => deleteReminder(reminderId),
    onSuccess: async () => {
      setStatus("リマインダーを削除しました");
      await invalidate();
    },
    onError: (error) => {
      void handlePrecondition(error);
      if (isPreconditionFailure(error)) {
        return;
      }
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
