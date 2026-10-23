import { atom, useSetAtom } from "jotai";
import { useEffect } from "react";

export const openFormCountAtom = atom(0);
export function useFormPresence(open: boolean) {
  const setCount = useSetAtom(openFormCountAtom);
  useEffect(() => {
    if (!open) return;
    setCount((count) => count + 1);
    return () => setCount((count) => Math.max(0, count - 1));
  }, [open, setCount]);
}
