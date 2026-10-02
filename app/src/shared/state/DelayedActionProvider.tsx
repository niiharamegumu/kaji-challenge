import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type PendingAction = { id: string; deadline: number };
type DelayedActionContextValue = {
  pendingActions: PendingAction[];
  schedule: (id: string, onComplete: (id: string) => void) => void;
  undo: (id: string) => void;
};

const DelayedActionContext = createContext<DelayedActionContextValue | null>(null);
export const DELAYED_ACTION_MS = 3_000;

export function useDelayedActions() {
  const context = useContext(DelayedActionContext);
  if (!context) throw new Error("DelayedActionProvider is required");
  return context;
}

export function DelayedActionProvider({ children }: { children: ReactNode }) {
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
    const deadline = Date.now() + DELAYED_ACTION_MS;
    const timer = setTimeout(() => {
      if (timers.current.get(id) !== timer) return;
      timers.current.delete(id);
      onComplete(id);
      setPendingActions((previous) => previous.filter((pending) => pending.id !== id));
    }, DELAYED_ACTION_MS);
    timers.current.set(id, timer);
    setPendingActions((previous) => [...previous, { id, deadline }]);
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
