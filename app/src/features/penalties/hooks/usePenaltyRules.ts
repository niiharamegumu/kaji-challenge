import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listPenaltyRules,
  type CreatePenaltyRuleRequest,
  deletePenaltyRule,
  patchPenaltyRule,
  postPenaltyRule,
  type UpdatePenaltyRuleRequest,
  type PenaltyRule,
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
    await queryClient.invalidateQueries({ queryKey: queryKeys.rules });
  };

  const createRule = useMutation({
    mutationFn: async (payload: CreatePenaltyRuleRequest) => postPenaltyRule(payload),
    onSuccess: async ({ data }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.rules });
      queryClient.setQueryData<PenaltyRule[]>(
        queryKeys.rules,
        (items) => items && [...items, data].sort((a, b) => a.threshold - b.threshold),
      );
      setStatus("ペナルティルールを作成しました");
      void invalidate();
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
    onSuccess: async (_, ruleId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.rules });
      queryClient.setQueryData<PenaltyRule[]>(queryKeys.rules, (items) =>
        items?.filter((item) => item.id !== ruleId),
      );
      setStatus("ルールを削除しました");
      void invalidate();
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
    onSuccess: async ({ data }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.rules });
      queryClient.setQueriesData<PenaltyRule[]>({ queryKey: queryKeys.rules }, (items) =>
        items
          ?.map((item) => (item.id === data.id ? data : item))
          .sort((a, b) => a.threshold - b.threshold),
      );
      setStatus("ルールを更新しました");
      void Promise.all([
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
