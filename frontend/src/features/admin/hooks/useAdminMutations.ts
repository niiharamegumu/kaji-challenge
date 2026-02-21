import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  type CreatePenaltyRuleRequest,
  type CreateTaskRequest,
  type PenaltyRule,
  deletePenaltyRule,
  deleteTask,
  patchMeNickname,
  patchPenaltyRule,
  patchTeamCurrent,
  postPenaltyRule,
  postTask,
  postTeamInvite,
  postTeamJoin,
  postTeamLeave,
} from "../../../lib/api/generated/client";
import { queryKeys } from "../../../shared/query/queryKeys";
import { extractHttpStatus, formatError } from "../../../shared/utils/errors";
import { INVITE_CODE_EXPIRES_IN_HOURS } from "../constants/invite";

type StatusSetter = (message: string) => void;

const teamMembershipRelatedQueryKeys = [
  queryKeys.me,
  queryKeys.teamMembers,
  queryKeys.home,
  queryKeys.tasks,
  queryKeys.rules,
  queryKeys.monthlySummary,
] as const;

const profileRelatedQueryKeys = [queryKeys.me, queryKeys.teamMembers] as const;

async function invalidateQueryKeys(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKeyList: readonly (readonly string[])[],
) {
  await Promise.all(
    queryKeyList.map((key) =>
      queryClient.invalidateQueries({
        queryKey: key,
      }),
    ),
  );
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

  return { createTask, removeTask };
}

export function usePenaltyRuleMutations(setStatus: StatusSetter) {
  const queryClient = useQueryClient();

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.rules });
  };

  const createRule = useMutation({
    mutationFn: async (payload: CreatePenaltyRuleRequest) =>
      postPenaltyRule(payload),
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
    mutationFn: async () =>
      postTeamInvite({ expiresInHours: INVITE_CODE_EXPIRES_IN_HOURS }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.currentInvite,
      });
    },
    onError: (error) => {
      setStatus(`招待コード発行に失敗しました: ${formatError(error)}`);
    },
  });

  const joinTeam = useMutation({
    mutationFn: async (code: string) => postTeamJoin({ code }),
    onSuccess: async () => {
      setStatus("チーム参加に成功しました");
      await invalidateQueryKeys(queryClient, teamMembershipRelatedQueryKeys);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.currentInvite,
      });
    },
    onError: (error) => {
      if (extractHttpStatus(error) === 409) {
        setStatus("すでに参加しています");
        return;
      }
      setStatus(`チーム参加に失敗しました: ${formatError(error)}`);
    },
  });

  const leaveTeam = useMutation({
    mutationFn: async () => postTeamLeave(),
    onSuccess: async () => {
      setStatus("新しい自分のチームを作成しました");
      await invalidateQueryKeys(queryClient, teamMembershipRelatedQueryKeys);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.currentInvite,
      });
    },
    onError: (error) => {
      setStatus(`チーム離脱に失敗しました: ${formatError(error)}`);
    },
  });

  return { createInvite, joinTeam, leaveTeam };
}

export function useProfileMutations(setStatus: StatusSetter) {
  const queryClient = useQueryClient();

  const updateNickname = useMutation({
    mutationFn: async (nickname: string) => patchMeNickname({ nickname }),
    onSuccess: async () => {
      setStatus("ニックネームを更新しました");
      await invalidateQueryKeys(queryClient, profileRelatedQueryKeys);
    },
    onError: (error) => {
      setStatus(`ニックネーム更新に失敗しました: ${formatError(error)}`);
    },
  });

  const updateTeamName = useMutation({
    mutationFn: async (name: string) => patchTeamCurrent({ name }),
    onSuccess: async () => {
      setStatus("チーム名を更新しました");
      await invalidateQueryKeys(queryClient, profileRelatedQueryKeys);
    },
    onError: (error) => {
      setStatus(`チーム名更新に失敗しました: ${formatError(error)}`);
    },
  });

  return { updateNickname, updateTeamName };
}
