import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAtomValue, useStore } from "jotai";
import { todoCompletionDelayAtom } from "./todoCompletionDelay";

type PendingAction = { id: string; deadline: number; durationMs: number };
type DelayedActionContextValue = {
  pendingActions: PendingAction[];
  schedule: (id: string, onComplete: (id: string) => void) => void;
  undo: (id: string) => void;
};

const DelayedActionContext = createContext<DelayedActionContextValue | null>(null);

export function useDelayedActions() {
  const context = useContext(DelayedActionContext);
  if (!context) throw new Error("DelayedActionProvider is required");
  return context;
}

export function DelayedActionProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  useAtomValue(todoCompletionDelayAtom);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const scheduled = timers.current;
    return () => {
      for (const timer of scheduled.values()) clearTimeout(timer);
      scheduled.clear();
    };
  }, []);

  const schedule = (id: string, onComplete: (id: string) => void) => {
    if (timers.current.has(id)) return;
    // A storage update can arrive before the subscription has rerendered this provider.
    const durationMs = store.get(todoCompletionDelayAtom);
    const deadline = Date.now() + durationMs;
    const timer = setTimeout(() => {
      if (timers.current.get(id) !== timer) return;
      timers.current.delete(id);
      onComplete(id);
      setPendingActions((previous) => previous.filter((pending) => pending.id !== id));
    }, durationMs);
    timers.current.set(id, timer);
    setPendingActions((previous) => [...previous, { id, deadline, durationMs }]);
  };

  const undo = (id: string) => {
    const timer = timers.current.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    timers.current.delete(id);
    setPendingActions((previous) => previous.filter((pending) => pending.id !== id));
  };

  return (
    <DelayedActionContext value={{ pendingActions, schedule, undo }}>
      {children}
    </DelayedActionContext>
  );
}
