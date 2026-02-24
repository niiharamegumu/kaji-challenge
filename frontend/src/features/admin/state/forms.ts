import { atom } from "jotai";

import {
  type TaskType,
  TaskType as TaskTypeConst,
} from "../../../lib/api/generated/client";

export type TaskFormState = {
  title: string;
  notes: string;
  type: TaskType;
  penaltyPoints: string;
  requiredCompletionsPerWeek: string;
};

export type RuleFormState = {
  name: string;
  threshold: string;
};

export const initialTaskFormState: TaskFormState = {
  title: "",
  notes: "",
  type: TaskTypeConst.daily,
  penaltyPoints: "1",
  requiredCompletionsPerWeek: "1",
};

export const initialRuleFormState: RuleFormState = {
  name: "",
  threshold: "1",
};

export const taskFormAtom = atom<TaskFormState>(initialTaskFormState);
export const ruleFormAtom = atom<RuleFormState>(initialRuleFormState);
