import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { cancelTeamRequests } from "../../../lib/api/serverClient";
import { getMe } from "../../../lib/api/operations";
import { authClient } from "../api/authClient";
import { queryKeys } from "../../../shared/query/queryKeys";
import { formatError } from "../../../shared/utils/errors";
import type { SessionState } from "../../../state/session";

type StatusSetter = (message: string) => void;
type SessionSetter = (value: SessionState) => void;

export function useMeQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async ({ signal }) => (await getMe({ signal })).data,
    enabled,
    staleTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useLoginAction(setStatus: StatusSetter) {
  return useCallback(async () => {
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/auth/callback",
        errorCallbackURL: "/auth/callback",
      });
      if (result.error) throw new Error(result.error.message);
    } catch (error) {
      setStatus(`ログイン開始に失敗しました: ${formatError(error)}`);
    }
  }, [setStatus]);
}

export function useLogoutAction(setStatus: StatusSetter, setSession: SessionSetter) {
  const queryClient = useQueryClient();

  return useCallback(async () => {
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message);
    } catch (error) {
      setStatus(`ログアウトに失敗しました: ${formatError(error)}`);
      return;
    }

    cancelTeamRequests();
    await queryClient.cancelQueries();

    setSession({ authenticated: false });
    setStatus("ログアウトしました");
    queryClient.removeQueries();
  }, [queryClient, setSession, setStatus]);
}
