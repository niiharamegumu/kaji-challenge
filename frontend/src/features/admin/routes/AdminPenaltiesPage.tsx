import { useAtom, useAtomValue } from "jotai";
import { useMemo } from "react";

import type {
  CreatePenaltyRuleRequest,
  UpdatePenaltyRuleRequest,
} from "../../../lib/api/generated/client";
import { isLoggedInAtom } from "../../../state/session";
import { statusMessageAtom } from "../../shell/state/status";
import { PenaltyRuleManager } from "../components/PenaltyRuleManager";
import { usePenaltyRuleMutations } from "../hooks/useAdminMutations";
import { usePenaltyRulesQuery } from "../hooks/useAdminQueries";
import { ruleFormAtom } from "../state/forms";

export function AdminPenaltiesPage() {
  const loggedIn = useAtomValue(isLoggedInAtom);
  const rulesQuery = usePenaltyRulesQuery(loggedIn);
  const activeRules = useMemo(
    () => (rulesQuery.data ?? []).filter((rule) => rule.deletedAt == null),
    [rulesQuery.data],
  );

  const [ruleForm, setRuleForm] = useAtom(ruleFormAtom);
  const [, setStatus] = useAtom(statusMessageAtom);
  const { createRule, removeRule, updateRule } =
    usePenaltyRuleMutations(setStatus);

  const handleCreateRule = async () => {
    const payload: CreatePenaltyRuleRequest = {
      name: ruleForm.name,
      threshold: Number(ruleForm.threshold),
    };
    await createRule.mutateAsync(payload);
  };

  const handleUpdateRule = async (
    ruleId: string,
    payload: UpdatePenaltyRuleRequest,
  ) => {
    await updateRule.mutateAsync({ ruleId, payload });
  };

  return (
    <section className="mt-2 w-full pb-1 md:mt-4">
      <PenaltyRuleManager
        form={ruleForm}
        rules={activeRules}
        onFormChange={(updater) => setRuleForm((prev) => updater(prev))}
        onCreate={() => {
          void handleCreateRule();
        }}
        onDelete={(ruleId) => {
          void removeRule.mutateAsync(ruleId);
        }}
        onUpdate={(ruleId, payload) => {
          void handleUpdateRule(ruleId, payload);
        }}
      />
    </section>
  );
}
