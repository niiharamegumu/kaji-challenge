import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";

import { getTeamCurrentMembers } from "../../../lib/api/generated/client";
import { queryKeys } from "../../../shared/query/queryKeys";
import { extractHttpStatus, formatError } from "../../../shared/utils/errors";
import { isLoggedInAtom, sessionAtom } from "../../../state/session";
import { LoginCard } from "../../auth/components/LoginCard";
import {
  useLoginAction,
  useLogoutAction,
  useMeQuery,
} from "../../auth/hooks/useAuthActions";
import { useExchangeCodeFallback } from "../../auth/hooks/useExchangeCodeFallback";
import { consumeFlashStatus } from "../../auth/state/flash";
import { FloatingNav } from "../components/FloatingNav";
import { StatusToast } from "../components/StatusToast";
import { statusMessageAtom } from "../state/status";

const protectedQueryKeys = [
  queryKeys.me,
  queryKeys.teamMembers,
  queryKeys.currentInvite,
  queryKeys.home,
  queryKeys.tasks,
  queryKeys.rules,
  queryKeys.monthlySummary,
] as const;

export type RootLayoutOutletContext = {
  currentUserId: string | null;
  currentTeamName: string;
  displayName: string;
};

export function RootLayout() {
  const queryClient = useQueryClient();
  const [, setSession] = useAtom(sessionAtom);
  const [status, setStatus] = useAtom(statusMessageAtom);
  const loggedIn = useAtomValue(isLoggedInAtom);
  const navigate = useNavigate();
  const location = useLocation();
  const handledInvalidSessionRef = useRef(false);

  const meQuery = useMeQuery(true);
  const currentUserID = meQuery.data?.user.id ?? null;
  const cachedMembersQuery = useQuery({
    queryKey: queryKeys.teamMembers,
    queryFn: async () => (await getTeamCurrentMembers()).data.items,
    enabled: false,
  });
  const login = useLoginAction(setStatus);
  const logoutAction = useLogoutAction(setStatus, setSession);
  const currentTeamName = meQuery.data?.memberships?.[0]?.teamName ?? "チーム";
  const preferredNickname =
    cachedMembersQuery.data
      ?.find((member) => member.userId === currentUserID)
      ?.nickname?.trim() ?? "";
  const currentUserName =
    preferredNickname.length > 0
      ? preferredNickname
      : (meQuery.data?.user.displayName ?? "ログイン中");
  const outletContext = useMemo<RootLayoutOutletContext>(
    () => ({
      currentUserId: currentUserID,
      currentTeamName,
      displayName: currentUserName,
    }),
    [currentTeamName, currentUserID, currentUserName],
  );
  const todayLabel = useMemo(() => {
    const now = new Date();
    const fullDate = new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(now);
    const weekday = new Intl.DateTimeFormat("ja-JP", {
      weekday: "short",
    }).format(now);
    return `${fullDate}（${weekday}）`;
  }, []);

  useEffect(() => {
    if (meQuery.isSuccess) {
      handledInvalidSessionRef.current = false;
      setSession({ authenticated: true });
      return;
    }
    if (!meQuery.isError) {
      return;
    }

    setSession({ authenticated: false });
    const statusCode = extractHttpStatus(meQuery.error);

    if (statusCode === 401) {
      if (!loggedIn && meQuery.data == null) {
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
      if (location.pathname !== "/") {
        navigate("/", { replace: true });
      }
      return;
    }

    setStatus(
      `ユーザー情報の取得に失敗しました: ${formatError(meQuery.error)}`,
    );
  }, [
    location.pathname,
    meQuery.error,
    meQuery.data,
    meQuery.isError,
    meQuery.isSuccess,
    loggedIn,
    navigate,
    queryClient,
    setSession,
    setStatus,
  ]);

  useExchangeCodeFallback(setSession, setStatus);

  useEffect(() => {
    const flash = consumeFlashStatus();
    if (flash != null) {
      setStatus(flash);
    }
  }, [setStatus]);

  const onDismissStatus = useCallback(() => {
    setStatus("");
  }, [setStatus]);

  const onLogin = useCallback(() => {
    void login();
  }, [login]);

  const onLogout = useCallback(() => {
    void logoutAction();
  }, [logoutAction]);

  const isAuthChecking =
    meQuery.status === "pending" && meQuery.data == null && !meQuery.isError;

  if (isAuthChecking) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,_var(--color-washi-50),_#fff,_var(--color-kohaku-50))] p-6 text-stone-700">
        <p>認証状態を確認中です...</p>
      </main>
    );
  }

  if (!loggedIn) {
    if (location.pathname !== "/") {
      return <Navigate to="/" replace />;
    }
    return <LoginCard status={status} onLogin={onLogin} />;
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_var(--color-washi-50),_#fff,_var(--color-kohaku-50))] p-4 pb-32 text-stone-800 md:p-8 md:pb-20">
      <StatusToast message={status} onDismiss={onDismissStatus} />

      <div className="mx-auto max-w-6xl">
        <header className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold tracking-wide">
              {currentTeamName}
            </h1>
            <span className="rounded-full bg-stone-100 px-3 py-2 text-sm text-stone-700">
              {todayLabel}
            </span>
          </div>
        </header>

        <Outlet context={outletContext} />
      </div>

      <FloatingNav currentUserName={currentUserName} onLogout={onLogout} />
    </main>
  );
}
