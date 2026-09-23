import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listPenaltyRules,
  type CreatePenaltyRuleRequest,
  deletePenaltyRule,
  patchPenaltyRule,
  postPenaltyRule,
  type UpdatePenaltyRuleRequest,
} from "../../../lib/api/operations";
import { queryKeys } from "../../../shared/query/queryKeys";
import { handleTeamStatePreconditionFailure } from "../../../shared/query/teamStateRefresh";
import { formatError } from "../../../shared/utils/errors";

export function usePenaltyRulesQuery() {
  return useSuspenseQuery({
    queryKey: queryKeys.rules,
    queryFn: async () => (await listPenaltyRules()).data.items,
  });
}

type StatusSetter = (message: string) => void;

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
    mutationFn: async (payload: CreatePenaltyRuleRequest) => postPenaltyRule(payload),
    onSuccess: async () => {
      setStatus("ペナルティルールを作成しました");
      await invalidate();
    },
    onError: async (error) => {
      if (await handleTeamStatePreconditionFailure(error, queryClient, setStatus)) {
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
    onError: async (error) => {
      if (await handleTeamStatePreconditionFailure(error, queryClient, setStatus)) {
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
    onError: async (error) => {
      if (await handleTeamStatePreconditionFailure(error, queryClient, setStatus)) {
        return;
      }
      setStatus(`ルール更新に失敗しました: ${formatError(error)}`);
    },
  });

  return { createRule, removeRule, updateRule };
}
