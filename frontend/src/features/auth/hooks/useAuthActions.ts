import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  getAuthGoogleStart,
  getMe,
  postAuthLogout,
} from "../../../lib/api/generated/client";
import { queryKeys } from "../../../shared/query/queryKeys";
import { formatError } from "../../../shared/utils/errors";
import type { SessionState } from "../../../state/session";

type StatusSetter = (message: string) => void;
type SessionSetter = (value: SessionState) => void;

export function useMeQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async () => (await getMe()).data,
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
      const res = await getAuthGoogleStart();
      window.location.href = res.data.authorizationUrl;
    } catch (error) {
      setStatus(`ログイン開始に失敗しました: ${formatError(error)}`);
    }
  }, [setStatus]);
}

export function useLogoutAction(
  setStatus: StatusSetter,
  setSession: SessionSetter,
) {
  const queryClient = useQueryClient();

  return useCallback(async () => {
    try {
      await postAuthLogout();
    } catch {
      // ignore logout request errors and clear local session anyway
    }

    setSession({ authenticated: false });
    setStatus("ログアウトしました");
    queryClient.removeQueries();
  }, [queryClient, setSession, setStatus]);
}
