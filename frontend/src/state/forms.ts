import { atom } from "jotai";

import {
  type TaskType,
  TaskType as TaskTypeConst,
} from "../lib/api/generated/client";

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

export const taskFormAtom = atom<TaskFormState>({
  title: "皿洗い",
  notes: "",
  type: TaskTypeConst.daily,
  penaltyPoints: "2",
  requiredCompletionsPerWeek: "3",
});

export const ruleFormAtom = atom<RuleFormState>({
  name: "買い出し担当",
  threshold: "10",
});
