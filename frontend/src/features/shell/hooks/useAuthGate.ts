import type { QueryClient, QueryStatus } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import type { MeResponse } from "../../../lib/api/generated/client";
import { queryKeys } from "../../../shared/query/queryKeys";
import { extractHttpStatus, formatError } from "../../../shared/utils/errors";
import type { SessionState } from "../../../state/session";

const protectedQueryKeys = [
  queryKeys.me,
  queryKeys.teamMembers,
  queryKeys.currentInvite,
  queryKeys.home,
  queryKeys.tasks,
  queryKeys.rules,
  queryKeys.reminders,
  queryKeys.reminderDefinitions,
  queryKeys.monthlySummary,
] as const;

type UseAuthGateParams = {
  loggedIn: boolean;
  meData: MeResponse | undefined;
  meStatus: QueryStatus;
  meIsError: boolean;
  meIsSuccess: boolean;
  meError: unknown;
  pathname: string;
  navigate: (to: string, options: { replace: boolean }) => void;
  queryClient: QueryClient;
  setSession: (value: SessionState) => void;
  setStatus: (message: string) => void;
  refetchMe: () => Promise<unknown>;
};

type UseAuthGateResult = {
  isAuthChecking: boolean;
  isAuthenticated: boolean;
  refetchAfterLogin: () => void;
};

export function useAuthGate({
  loggedIn,
  meData,
  meStatus,
  meIsError,
  meIsSuccess,
  meError,
  pathname,
  navigate,
  queryClient,
  setSession,
  setStatus,
  refetchMe,
}: UseAuthGateParams): UseAuthGateResult {
  const handledInvalidSessionRef = useRef(false);
  const hasValidatedSessionRef = useRef(false);
  const retriedAfterLoginRef = useRef(false);

  const refetchAfterLogin = useCallback(() => {
    if (retriedAfterLoginRef.current || loggedIn) {
      return;
    }
    retriedAfterLoginRef.current = true;
    void refetchMe();
  }, [loggedIn, refetchMe]);

  useEffect(() => {
    if (!loggedIn) {
      hasValidatedSessionRef.current = false;
      retriedAfterLoginRef.current = false;
    }
  }, [loggedIn]);

  useEffect(() => {
    if (meIsSuccess) {
      handledInvalidSessionRef.current = false;
      hasValidatedSessionRef.current = true;
      retriedAfterLoginRef.current = false;
      setSession({ authenticated: true });
      return;
    }
    if (!meIsError) {
      return;
    }

    setSession({ authenticated: false });
    const statusCode = extractHttpStatus(meError);

    if (statusCode === 401) {
      if (!hasValidatedSessionRef.current) {
        handledInvalidSessionRef.current = false;
        return;
      }
      if (!loggedIn && meData == null) {
        handledInvalidSessionRef.current = false;
        return;
      }
      if (handledInvalidSessionRef.current) {
        return;
      }
      handledInvalidSessionRef.current = true;

      for (const key of protectedQueryKeys) {
        queryClient.removeQueries({ queryKey: key });
      }
      setStatus(
        "アカウント情報が無効になったため、トップページへ戻りました。再ログインしてください。",
      );
      if (pathname !== "/") {
        navigate("/", { replace: true });
      }
      return;
    }

    setStatus(`ユーザー情報の取得に失敗しました: ${formatError(meError)}`);
  }, [
    loggedIn,
    meData,
    meError,
    meIsError,
    meIsSuccess,
    navigate,
    pathname,
    queryClient,
    setSession,
    setStatus,
  ]);

  const isAuthChecking = meStatus === "pending" && meData == null && !meIsError;
  const isAuthenticated = loggedIn || meIsSuccess || meData != null;

  return {
    isAuthChecking,
    isAuthenticated,
    refetchAfterLogin,
  };
}
