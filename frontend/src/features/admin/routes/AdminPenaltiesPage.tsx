import { useAtom, useAtomValue } from "jotai";
import { useMemo } from "react";

import type { CreatePenaltyRuleRequest } from "../../../lib/api/generated/client";
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
  const { createRule, removeRule } = usePenaltyRuleMutations(setStatus);

  const handleCreateRule = async () => {
    const payload: CreatePenaltyRuleRequest = {
      name: ruleForm.name,
      threshold: Number(ruleForm.threshold),
    };
    await createRule.mutateAsync(payload);
  };

  return (
    <section className="mt-4 w-full pb-2">
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
      />
    </section>
  );
}
