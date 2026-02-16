import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { formatError, todayString } from "../../lib/errors";
import {
  deletePenaltyRule,
  deleteTask,
  getHome,
  getMe,
  getPenaltySummaryMonthly,
  listPenaltyRules,
  listTasks,
  patchPenaltyRule,
  patchTask,
  postPenaltyRule,
  postTask,
  postTaskCompletionToggle,
  postTeamInvite,
  postTeamJoin,
  type CreatePenaltyRuleRequest,
  type CreateTaskRequest,
  type PenaltyRule,
} from "../../lib/api/generated/client";
import { queryKeys } from "../../lib/query/queryKeys";

type StatusSetter = (message: string) => void;

export function useMeQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async () => (await getMe()).data,
    enabled,
  });
}

export function useHomeQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.home,
    queryFn: async () => (await getHome()).data,
    enabled,
  });
}

export function useMonthlySummaryQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.monthlySummary,
    queryFn: async () => (await getPenaltySummaryMonthly()).data,
    enabled,
  });
}

export function useTasksQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.tasks,
    queryFn: async () => (await listTasks()).data.items,
    enabled,
  });
}

export function usePenaltyRulesQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.rules,
    queryFn: async () => (await listPenaltyRules()).data.items,
    enabled,
  });
}

export function useRefreshAll(setStatus: StatusSetter) {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries();
    setStatus("最新状態に同期しました");
  };
}

export function useToggleCompletionMutation(setStatus: StatusSetter) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) =>
      postTaskCompletionToggle(taskId, { targetDate: todayString() }),
    onSuccess: async () => {
      setStatus("完了状態を更新しました");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.monthlySummary }),
      ]);
    },
    onError: (error) => {
      setStatus(`完了更新に失敗しました: ${formatError(error)}`);
    },
  });
}

export function useTaskMutations(setStatus: StatusSetter) {
  const queryClient = useQueryClient();

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
      queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      queryClient.invalidateQueries({ queryKey: queryKeys.monthlySummary }),
    ]);
  };

  const createTask = useMutation({
    mutationFn: async (payload: CreateTaskRequest) => postTask(payload),
    onSuccess: async () => {
      setStatus("タスクを作成しました");
      await invalidate();
    },
    onError: (error) => {
      setStatus(`タスク作成に失敗しました: ${formatError(error)}`);
    },
  });

  const toggleTask = useMutation({
    mutationFn: async ({ taskId, isActive }: { taskId: string; isActive: boolean }) =>
      patchTask(taskId, { isActive: !isActive }),
    onSuccess: async () => {
      setStatus("タスク状態を更新しました");
      await invalidate();
    },
    onError: (error) => {
      setStatus(`タスク更新に失敗しました: ${formatError(error)}`);
    },
  });

  const removeTask = useMutation({
    mutationFn: async (taskId: string) => deleteTask(taskId),
    onSuccess: async () => {
      setStatus("タスクを削除しました");
      await invalidate();
    },
    onError: (error) => {
      setStatus(`タスク削除に失敗しました: ${formatError(error)}`);
    },
  });

  return { createTask, toggleTask, removeTask };
}

export function usePenaltyRuleMutations(setStatus: StatusSetter) {
  const queryClient = useQueryClient();

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.rules });
  };

  const createRule = useMutation({
    mutationFn: async (payload: CreatePenaltyRuleRequest) => postPenaltyRule(payload),
    onSuccess: async () => {
      setStatus("ペナルティルールを作成しました");
      await invalidate();
    },
    onError: (error) => {
      setStatus(`ルール作成に失敗しました: ${formatError(error)}`);
    },
  });

  const toggleRule = useMutation({
    mutationFn: async (rule: PenaltyRule) =>
      patchPenaltyRule(rule.id, { isActive: !rule.isActive }),
    onSuccess: async () => {
      setStatus("ルール状態を更新しました");
      await invalidate();
    },
    onError: (error) => {
      setStatus(`ルール更新に失敗しました: ${formatError(error)}`);
    },
  });

  const removeRule = useMutation({
    mutationFn: async (ruleId: string) => deletePenaltyRule(ruleId),
    onSuccess: async () => {
      setStatus("ルールを削除しました");
      await invalidate();
    },
    onError: (error) => {
      setStatus(`ルール削除に失敗しました: ${formatError(error)}`);
    },
  });

  return { createRule, toggleRule, removeRule };
}

export function useInviteMutations(setStatus: StatusSetter) {
  const queryClient = useQueryClient();

  const createInvite = useMutation({
    mutationFn: async () => postTeamInvite({ expiresInHours: 72, maxUses: 2 }),
    onError: (error) => {
      setStatus(`招待コード発行に失敗しました: ${formatError(error)}`);
    },
  });

  const joinTeam = useMutation({
    mutationFn: async (code: string) => postTeamJoin({ code }),
    onSuccess: async () => {
      setStatus("チーム参加に成功しました");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.me }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
        queryClient.invalidateQueries({ queryKey: queryKeys.rules }),
        queryClient.invalidateQueries({ queryKey: queryKeys.monthlySummary }),
      ]);
    },
    onError: (error) => {
      setStatus(`チーム参加に失敗しました: ${formatError(error)}`);
    },
  });

  return { createInvite, joinTeam };
}
