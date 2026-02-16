import { useAtom, useAtomValue } from "jotai";

import {
  type CreatePenaltyRuleRequest,
  type CreateTaskRequest,
  TaskType as TaskTypeConst,
} from "../../../lib/api/generated/client";
import { isLoggedInAtom } from "../../../state/session";
import { statusMessageAtom } from "../../shell/state/status";
import { InviteManager } from "../components/InviteManager";
import { PenaltyRuleManager } from "../components/PenaltyRuleManager";
import { TaskManager } from "../components/TaskManager";
import {
  useInviteMutations,
  usePenaltyRuleMutations,
  useTaskMutations,
} from "../hooks/useAdminMutations";
import { usePenaltyRulesQuery, useTasksQuery } from "../hooks/useAdminQueries";
import { ruleFormAtom, taskFormAtom } from "../state/forms";
import { inviteCodeAtom, joinCodeAtom } from "../state/ui";

export function AdminPage() {
  const loggedIn = useAtomValue(isLoggedInAtom);
  const tasksQuery = useTasksQuery(loggedIn);
  const rulesQuery = usePenaltyRulesQuery(loggedIn);

  const [taskForm, setTaskForm] = useAtom(taskFormAtom);
  const [ruleForm, setRuleForm] = useAtom(ruleFormAtom);
  const [inviteCode, setInviteCode] = useAtom(inviteCodeAtom);
  const [joinCode, setJoinCode] = useAtom(joinCodeAtom);
  const [, setStatus] = useAtom(statusMessageAtom);

  const { createTask, toggleTask, removeTask } = useTaskMutations(setStatus);
  const { createRule, toggleRule, removeRule } =
    usePenaltyRuleMutations(setStatus);
  const { createInvite, joinTeam } = useInviteMutations(setStatus);

  const handleCreateTask = async () => {
    const payload: CreateTaskRequest = {
      title: taskForm.title,
      notes: taskForm.notes === "" ? undefined : taskForm.notes,
      type: taskForm.type,
      penaltyPoints: Number(taskForm.penaltyPoints),
      requiredCompletionsPerWeek:
        taskForm.type === TaskTypeConst.weekly
          ? Number(taskForm.requiredCompletionsPerWeek)
          : undefined,
    };
    await createTask.mutateAsync(payload);
  };

  const handleCreateRule = async () => {
    const payload: CreatePenaltyRuleRequest = {
      name: ruleForm.name,
      threshold: Number(ruleForm.threshold),
      isActive: true,
    };
    await createRule.mutateAsync(payload);
  };

  const handleCreateInvite = async () => {
    const res = await createInvite.mutateAsync();
    setInviteCode(res.data.code);
    setStatus("招待コードを発行しました");
  };

  return (
    <section className="mt-4 grid gap-4 lg:grid-cols-2">
      <TaskManager
        form={taskForm}
        tasks={tasksQuery.data ?? []}
        onFormChange={(updater) => setTaskForm((prev) => updater(prev))}
        onCreate={() => {
          void handleCreateTask();
        }}
        onToggleActive={(taskId, isActive) => {
          void toggleTask.mutateAsync({ taskId, isActive });
        }}
        onDelete={(taskId) => {
          void removeTask.mutateAsync(taskId);
        }}
      />

      <div className="grid gap-4">
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

        <InviteManager
          inviteCode={inviteCode}
          joinCode={joinCode}
          onJoinCodeChange={setJoinCode}
          onCreateInvite={() => {
            void handleCreateInvite();
          }}
          onJoinTeam={() => {
            void joinTeam.mutateAsync(joinCode);
          }}
        />
      </div>
    </section>
  );
}
