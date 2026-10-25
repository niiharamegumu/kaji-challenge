import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { AssistRequest } from "../../../contracts/assist";
import { teamRequestSignal } from "../../../lib/api/serverClient";
import { queryKeys } from "../../../shared/query/queryKeys";
import { useLocation } from "../../../shared/router/navigation";
import { statusMessageAtom } from "../../../shared/state/status";
import { openFormCountAtom } from "../../../shared/state/overlay";
import { sendAssistTurn, transcribeAssistAudio } from "../api/assistApi";
import { VoiceSession } from "../model/VoiceSession";
import { AssistPanel } from "./AssistPanel";

export type AssistControls = {
  open: () => void;
  close: () => void;
  isOpen: boolean;
  disabled: boolean;
};
export function AssistHost({
  teamId,
  children,
}: {
  teamId: string | null;
  children: (controls: AssistControls) => ReactNode;
}) {
  const queryClient = useQueryClient();
  const setStatus = useSetAtom(statusMessageAtom);
  const forms = useAtomValue(openFormCountAtom);
  const { pathname } = useLocation();
  const mutation = useMutation({
    mutationKey: ["assist-turn"],
    gcTime: 0,
    retry: false,
    networkMode: "always",
    mutationFn: ({ input, signal }: { input: AssistRequest; signal: AbortSignal }) =>
      sendAssistTurn(input, signal),
  });
  const [session] = useState(() => {
    return new VoiceSession(teamId ?? "", transcribeAssistAudio, async (input, signal) => {
      // StrictMode can replace the shared controller after mounting. Pin it per turn.
      const teamSignal = teamRequestSignal();
      try {
        return await mutation.mutateAsync({ input, signal });
      } finally {
        // Do not retain audio/transcripts in the mutation cache after a turn.
        mutation.reset();
        // An aborted HTTP response may follow a committed write. Refresh, never resend.
        if (!teamSignal.aborted)
          void queryClient.invalidateQueries({ queryKey: queryKeys.todoItems });
      }
    });
  });
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState !== "visible") session.close();
    };
    const leave = session.close;
    const teamSignal = teamRequestSignal();
    teamSignal.addEventListener("abort", session.close);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leave);
    return () => {
      teamSignal.removeEventListener("abort", session.close);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leave);
      session.close();
    };
  }, [session]);
  useEffect(() => {
    session.close();
  }, [pathname, session]);
  useEffect(() => {
    if (!state.open && state.message) setStatus(state.message);
  }, [state.open, state.message, setStatus]);
  return (
    <>
      {children({
        open: session.start,
        close: session.close,
        isOpen: state.open,
        disabled: forms > 0 || !teamId,
      })}
      <AssistPanel session={session} state={state} />
    </>
  );
}
