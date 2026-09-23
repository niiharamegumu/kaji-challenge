import { atom } from "jotai";

export type RuleFormState = {
  name: string;
  threshold: string;
};

export const initialRuleFormState: RuleFormState = {
  name: "",
  threshold: "1",
};

export const ruleFormAtom = atom<RuleFormState>(initialRuleFormState);
