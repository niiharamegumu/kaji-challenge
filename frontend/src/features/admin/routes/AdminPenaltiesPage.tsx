import { useAtom, useAtomValue } from "jotai";

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

  const [ruleForm, setRuleForm] = useAtom(ruleFormAtom);
  const [, setStatus] = useAtom(statusMessageAtom);
  const { createRule, toggleRule, removeRule } =
    usePenaltyRuleMutations(setStatus);

  const handleCreateRule = async () => {
    const payload: CreatePenaltyRuleRequest = {
      name: ruleForm.name,
      threshold: Number(ruleForm.threshold),
      isActive: true,
    };
    await createRule.mutateAsync(payload);
  };

  return (
    <section className="mt-4 w-full pb-2">
      <PenaltyRuleManager
        form={ruleForm}
        rules={rulesQuery.data ?? []}
        onFormChange={(updater) => setRuleForm((prev) => updater(prev))}
        onCreate={() => {
          void handleCreateRule();
        }}
        onToggle={(rule) => {
          void toggleRule.mutateAsync(rule);
        }}
        onDelete={(ruleId) => {
          void removeRule.mutateAsync(ruleId);
        }}
      />
    </section>
  );
}
