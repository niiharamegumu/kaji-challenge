import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { LoaderCircle } from "lucide-react";
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
  const hasValidatedSessionRef = useRef(false);
  const retriedAfterLoginRef = useRef(false);

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
  const refetchAfterLogin = useCallback(() => {
    if (retriedAfterLoginRef.current || loggedIn) {
      return;
    }
    retriedAfterLoginRef.current = true;
    void meQuery.refetch();
  }, [loggedIn, meQuery]);

  useEffect(() => {
    if (!loggedIn) {
      hasValidatedSessionRef.current = false;
      retriedAfterLoginRef.current = false;
    }
  }, [loggedIn]);

  useEffect(() => {
    if (meQuery.isSuccess) {
      handledInvalidSessionRef.current = false;
      hasValidatedSessionRef.current = true;
      retriedAfterLoginRef.current = false;
      setSession({ authenticated: true });
      return;
    }
    if (!meQuery.isError) {
      return;
    }

    setSession({ authenticated: false });
    const statusCode = extractHttpStatus(meQuery.error);

    if (statusCode === 401) {
      if (!hasValidatedSessionRef.current) {
        handledInvalidSessionRef.current = false;
        return;
      }
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

  useExchangeCodeFallback(setSession, setStatus, refetchAfterLogin);

  useEffect(() => {
    const flash = consumeFlashStatus();
    if (flash != null) {
      setStatus(flash.message);
      if (flash.kind === "login_success") {
        refetchAfterLogin();
      }
    }
  }, [refetchAfterLogin, setStatus]);

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
  const isAuthenticated = loggedIn || meQuery.isSuccess || meQuery.data != null;

  if (isAuthChecking) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,_var(--color-washi-50),_#fff,_var(--color-kohaku-50))] px-2 py-3 text-stone-700 md:p-6">
        <div className="flex justify-center">
          <LoaderCircle
            size={24}
            className="text-stone-500 animate-spin motion-reduce:animate-none"
            aria-label="読み込み中"
            role="status"
          />
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    if (location.pathname !== "/") {
      return <Navigate to="/" replace />;
    }
    return <LoginCard status={status} onLogin={onLogin} />;
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_var(--color-washi-50),_#fff,_var(--color-kohaku-50))] px-2 py-2.5 pb-28 text-stone-800 md:p-8 md:pb-20">
      <StatusToast message={status} onDismiss={onDismissStatus} />

      <div className="mx-auto max-w-6xl">
        <header className="rounded-xl border border-stone-200 bg-white/90 p-2.5 shadow-sm backdrop-blur md:rounded-2xl md:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 md:gap-3">
            <h1 className="text-xl font-semibold tracking-normal md:text-2xl md:font-bold md:tracking-wide">
              {currentTeamName}
            </h1>
            <span className="text-xs whitespace-nowrap text-stone-700 md:text-sm">
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
