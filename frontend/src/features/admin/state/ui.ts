import { atom } from "jotai";

export type InviteState = {
  code: string;
  expiresAt: string;
};

export const inviteCodeAtom = atom<InviteState | null>(null);
export const joinCodeAtom = atom("");
