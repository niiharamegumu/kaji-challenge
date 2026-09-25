import { useAtom } from "jotai";
import { Plus } from "lucide-react";
import { useState } from "react";

import type {
  CreatePenaltyRuleRequest,
  UpdatePenaltyRuleRequest,
} from "../../../lib/api/operations";
import { FooterQuickAction } from "../../../shared/components/FooterQuickAction";
import { statusMessageAtom } from "../../../shared/state/status";
import { PenaltyRuleCreateForm, PenaltyRuleManager } from "../components/PenaltyRuleManager";
import { usePenaltyRuleMutations, usePenaltyRulesQuery } from "../hooks/usePenaltyRules";
import { initialRuleFormState, ruleFormAtom } from "../state/forms";

export function PenaltiesPage() {
  const rulesQuery = usePenaltyRulesQuery();
  const activeRules = rulesQuery.data.filter((rule) => rule.deletedAt == null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const [ruleForm, setRuleForm] = useAtom(ruleFormAtom);
  const [, setStatus] = useAtom(statusMessageAtom);
  const { createRule, removeRule, updateRule } = usePenaltyRuleMutations(setStatus);

  const handleCreateRule = async () => {
    const payload: CreatePenaltyRuleRequest = {
      name: ruleForm.name,
      threshold: Number(ruleForm.threshold),
    };
    await createRule.mutateAsync(payload);
    setRuleForm(initialRuleFormState);
  };

  const handleUpdateRule = async (ruleId: string, payload: UpdatePenaltyRuleRequest) => {
    await updateRule.mutateAsync({ ruleId, payload });
  };

  return (
    <section className="mt-2 w-full pb-1 md:mt-4">
      <PenaltyRuleManager
        form={ruleForm}
        rules={activeRules}
        isCreateOpen={false}
        isCreating={createRule.isPending}
        createFailed={createRule.isError}
        isUpdating={updateRule.isPending}
        showCreateButton={false}
        onCloseCreate={() => setIsCreateOpen(false)}
        onFormChange={(updater) => setRuleForm((prev) => updater(prev))}
        onOpenCreate={() => {
          createRule.reset();
          setIsCreateOpen(true);
        }}
        onCreate={handleCreateRule}
        onDelete={(ruleId) => {
          removeRule.mutate(ruleId);
        }}
        onUpdate={handleUpdateRule}
      />
      <FooterQuickAction
        isOpen={isCreateOpen}
        isSubmitting={createRule.isPending}
        submitFailed={createRule.isError}
        title="ペナルティルールを追加"
        submitLabel="追加する"
        submitIcon={<Plus size={16} aria-hidden="true" />}
        submitDisabled={ruleForm.name.trim().length === 0 || Number(ruleForm.threshold) < 1}
        onOpen={() => {
          createRule.reset();
          setIsCreateOpen(true);
        }}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={() => {
          return handleCreateRule().then(() => {
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
