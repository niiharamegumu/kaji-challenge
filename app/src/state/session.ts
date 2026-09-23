import { atom } from "jotai";

export type SessionState = {
  authenticated: boolean;
};

export const sessionAtom = atom<SessionState>({
  authenticated: false,
});

export const isLoggedInAtom = atom((get) => {
  return get(sessionAtom).authenticated;
});
