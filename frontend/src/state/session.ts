import { atom } from "jotai";

export type SessionState = {
  token: string | null;
};

export const sessionAtom = atom<SessionState>({
  token: null,
});

export const isLoggedInAtom = atom((get) => {
  const token = get(sessionAtom).token;
  return token != null && token !== "";
});
