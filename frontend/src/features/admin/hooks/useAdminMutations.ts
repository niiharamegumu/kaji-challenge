import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  type CreatePenaltyRuleRequest,
  type CreateTaskRequest,
  type InviteCodeResponse,
  type UpdatePenaltyRuleRequest,
  type UpdateTaskRequest,
  deletePenaltyRule,
  deleteTask,
  patchMeColor,
  patchMeNickname,
  patchPenaltyRule,
  patchTask,
  patchTeamCurrent,
  postPenaltyRule,
  postTask,
  postTeamInvite,
  postTeamJoin,
  postTeamLeave,
} from "../../../lib/api/generated/client";
import { queryKeys } from "../../../shared/query/queryKeys";
import {
  extractHttpStatus,
  formatError,
  isPreconditionFailure,
} from "../../../shared/utils/errors";
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

const nicknameRelatedQueryKeys = [queryKeys.teamMembers] as const;
const colorRelatedQueryKeys = [
  queryKeys.teamMembers,
  queryKeys.me,
  queryKeys.home,
  queryKeys.monthlySummary,
] as const;
const teamNameRelatedQueryKeys = [queryKeys.me] as const;

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

async function handlePreconditionFailure(
  error: unknown,
  queryClient: ReturnType<typeof useQueryClient>,
  setStatus: StatusSetter,
) {
  if (!isPreconditionFailure(error)) {
    return;
  }
  await invalidateQueryKeys(queryClient, teamMembershipRelatedQueryKeys);
  await queryClient.invalidateQueries({ queryKey: queryKeys.currentInvite });
  setStatus(
    "他メンバーの更新を検知しました。最新状態に更新したので、もう一度操作してください。",
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
      void handlePreconditionFailure(error, queryClient, setStatus);
      if (isPreconditionFailure(error)) {
        return;
      }
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
      void handlePreconditionFailure(error, queryClient, setStatus);
      if (isPreconditionFailure(error)) {
        return;
      }
      setStatus(`タスク削除に失敗しました: ${formatError(error)}`);
    },
  });

  const updateTask = useMutation({
    mutationFn: async ({
      taskId,
      payload,
    }: {
      taskId: string;
      payload: UpdateTaskRequest;
    }) => patchTask(taskId, payload),
    onSuccess: async () => {
      setStatus("タスクを更新しました");
      await invalidate();
    },
    onError: (error) => {
      void handlePreconditionFailure(error, queryClient, setStatus);
      if (isPreconditionFailure(error)) {
        return;
      }
      setStatus(`タスク更新に失敗しました: ${formatError(error)}`);
    },
  });

  return { createTask, removeTask, updateTask };
}

export function usePenaltyRuleMutations(setStatus: StatusSetter) {
  const queryClient = useQueryClient();

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.rules }),
      queryClient.invalidateQueries({
        queryKey: [...queryKeys.rules, "withDeleted"],
      }),
    ]);
  };

  const createRule = useMutation({
    mutationFn: async (payload: CreatePenaltyRuleRequest) =>
      postPenaltyRule(payload),
    onSuccess: async () => {
      setStatus("ペナルティルールを作成しました");
      await invalidate();
    },
    onError: (error) => {
      void handlePreconditionFailure(error, queryClient, setStatus);
      if (isPreconditionFailure(error)) {
        return;
      }
      setStatus(`ルール作成に失敗しました: ${formatError(error)}`);
    },
  });

  const removeRule = useMutation({
    mutationFn: async (ruleId: string) => deletePenaltyRule(ruleId),
    onSuccess: async () => {
      setStatus("ルールを削除しました");
      await invalidate();
    },
    onError: (error) => {
      void handlePreconditionFailure(error, queryClient, setStatus);
      if (isPreconditionFailure(error)) {
        return;
      }
      setStatus(`ルール削除に失敗しました: ${formatError(error)}`);
    },
  });

  const updateRule = useMutation({
    mutationFn: async ({
      ruleId,
      payload,
    }: {
      ruleId: string;
      payload: UpdatePenaltyRuleRequest;
    }) => patchPenaltyRule(ruleId, payload),
    onSuccess: async () => {
      setStatus("ルールを更新しました");
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: queryKeys.monthlySummary }),
      ]);
    },
    onError: (error) => {
      void handlePreconditionFailure(error, queryClient, setStatus);
      if (isPreconditionFailure(error)) {
        return;
      }
      setStatus(`ルール更新に失敗しました: ${formatError(error)}`);
    },
  });

  return { createRule, removeRule, updateRule };
}

export function useInviteMutations(setStatus: StatusSetter) {
  const queryClient = useQueryClient();

  const createInvite = useMutation({
    mutationFn: async () =>
      postTeamInvite({ expiresInHours: INVITE_CODE_EXPIRES_IN_HOURS }),
    onSuccess: async (response) => {
      queryClient.setQueryData<InviteCodeResponse>(
        queryKeys.currentInvite,
        response.data,
      );
    },
    onError: (error) => {
      void handlePreconditionFailure(error, queryClient, setStatus);
      if (isPreconditionFailure(error)) {
        return;
      }
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
      if (isPreconditionFailure(error)) {
        void handlePreconditionFailure(error, queryClient, setStatus);
        return;
      }
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
      void handlePreconditionFailure(error, queryClient, setStatus);
      if (isPreconditionFailure(error)) {
        return;
      }
      setStatus(`チーム離脱に失敗しました: ${formatError(error)}`);
    },
  });

  return { createInvite, joinTeam, leaveTeam };
}

export function useProfileMutations(setStatus: StatusSetter) {
  const queryClient = useQueryClient();

  const updateNickname = useMutation({
    mutationFn: async (nickname: string) => patchMeNickname({ nickname }),
    onSuccess: async (_, nickname) => {
      const message =
        nickname.trim().length === 0
          ? "ニックネームをリセットしました"
          : "ニックネームを更新しました";
      setStatus(message);
      await invalidateQueryKeys(queryClient, nicknameRelatedQueryKeys);
    },
    onError: (error) => {
      void handlePreconditionFailure(error, queryClient, setStatus);
      if (isPreconditionFailure(error)) {
        return;
      }
      setStatus(`ニックネーム更新に失敗しました: ${formatError(error)}`);
    },
  });

  const updateColor = useMutation({
    mutationFn: async (colorHex: string | null) => patchMeColor({ colorHex }),
    onSuccess: async (_, colorHex) => {
      const message =
        colorHex == null ? "表示カラーをリセットしました" : "表示カラーを更新しました";
      setStatus(message);
      await invalidateQueryKeys(queryClient, colorRelatedQueryKeys);
    },
    onError: (error) => {
      void handlePreconditionFailure(error, queryClient, setStatus);
      if (isPreconditionFailure(error)) {
        return;
      }
      setStatus(`表示カラー更新に失敗しました: ${formatError(error)}`);
    },
  });

  const updateTeamName = useMutation({
    mutationFn: async (name: string) => patchTeamCurrent({ name }),
    onSuccess: async () => {
      setStatus("チーム名を更新しました");
      await invalidateQueryKeys(queryClient, teamNameRelatedQueryKeys);
    },
    onError: (error) => {
      void handlePreconditionFailure(error, queryClient, setStatus);
      if (isPreconditionFailure(error)) {
        return;
      }
      setStatus(`チーム名更新に失敗しました: ${formatError(error)}`);
    },
  });

  return { updateNickname, updateColor, updateTeamName };
}
