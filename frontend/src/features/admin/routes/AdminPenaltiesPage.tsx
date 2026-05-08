import { useAtom } from "jotai";
import { Plus } from "lucide-react";
import { useState } from "react";

import type {
  CreatePenaltyRuleRequest,
  UpdatePenaltyRuleRequest,
} from "../../../lib/api/generated/client";
import { FooterQuickAction } from "../../../shared/components/FooterQuickAction";
import { statusMessageAtom } from "../../../shared/state/status";
import {
  PenaltyRuleCreateForm,
  PenaltyRuleManager,
} from "../components/PenaltyRuleManager";
import { usePenaltyRuleMutations } from "../hooks/useAdminMutations";
import { usePenaltyRulesQuery } from "../hooks/useAdminQueries";
import { initialRuleFormState, ruleFormAtom } from "../state/forms";

export function AdminPenaltiesPage() {
  const rulesQuery = usePenaltyRulesQuery();
  const activeRules = rulesQuery.data.filter((rule) => rule.deletedAt == null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

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
    setRuleForm(initialRuleFormState);
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
        isCreateOpen={false}
        showCreateButton={false}
        onCloseCreate={() => setIsCreateOpen(false)}
        onFormChange={(updater) => setRuleForm((prev) => updater(prev))}
        onOpenCreate={() => setIsCreateOpen(true)}
        onCreate={handleCreateRule}
        onDelete={(ruleId) => {
          void removeRule.mutateAsync(ruleId);
        }}
        onUpdate={handleUpdateRule}
      />
      <FooterQuickAction
        isOpen={isCreateOpen}
        title="ペナルティルールを追加"
        submitLabel="追加する"
        submitIcon={<Plus size={16} aria-hidden="true" />}
        submitDisabled={
          ruleForm.name.trim().length === 0 || Number(ruleForm.threshold) < 1
        }
        onOpen={() => setIsCreateOpen(true)}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={() => {
          void handleCreateRule().then(() => {
            setIsCreateOpen(false);
          });
        }}
      >
        <PenaltyRuleCreateForm
          form={ruleForm}
          onFormChange={(updater) => setRuleForm((prev) => updater(prev))}
        />
      </FooterQuickAction>
    </section>
  );
}
