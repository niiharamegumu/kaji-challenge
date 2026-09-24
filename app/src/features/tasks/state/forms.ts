import { atom } from "jotai";
import { type TaskType, TaskType as TaskTypeConst } from "../../../lib/api/operations";

export type TaskFormState = {
  title: string;
  notes: string;
  type: TaskType;
  penaltyPoints: string;
  requiredCompletionsPerWeek: string;
};

export const initialTaskFormState: TaskFormState = {
  title: "",
  notes: "",
  type: TaskTypeConst.daily,
  penaltyPoints: "1",
  requiredCompletionsPerWeek: "1",
};

export const taskFormAtom = atom<TaskFormState>(initialTaskFormState);
