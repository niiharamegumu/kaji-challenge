import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { LoaderCircle } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";

import { getTeamCurrentMembers } from "../../../lib/api/generated/client";
import { queryKeys } from "../../../shared/query/queryKeys";
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
import { useAuthGate } from "../hooks/useAuthGate";
import { useCurrentUserProfile } from "../hooks/useCurrentUserProfile";
import { useTeamStateStream } from "../hooks/useTeamStateStream";
import { statusMessageAtom } from "../state/status";

export type RootLayoutOutletContext = {
  currentUserId: string | null;
  currentTeamName: string;
  displayName: string;
  colorHex: string | null;
};

export function RootLayout() {
  const queryClient = useQueryClient();
  const [, setSession] = useAtom(sessionAtom);
  const [status, setStatus] = useAtom(statusMessageAtom);
  const loggedIn = useAtomValue(isLoggedInAtom);
  const navigate = useNavigate();
  const location = useLocation();

  const meQuery = useMeQuery(true);
  const cachedMembersQuery = useQuery({
    queryKey: queryKeys.teamMembers,
    queryFn: async () => (await getTeamCurrentMembers()).data.items,
    enabled: false,
  });
  const login = useLoginAction(setStatus);
  const logoutAction = useLogoutAction(setStatus, setSession);
  const {
    currentUserId,
    currentTeamName,
    currentUserName,
    currentUserColorHex,
  } = useCurrentUserProfile(meQuery.data, cachedMembersQuery.data);
  const { isAuthChecking, isAuthenticated, refetchAfterLogin } = useAuthGate({
    loggedIn,
    meData: meQuery.data,
    meStatus: meQuery.status,
    meIsError: meQuery.isError,
    meIsSuccess: meQuery.isSuccess,
    meError: meQuery.error,
    pathname: location.pathname,
    navigate,
    queryClient,
    setSession,
    setStatus,
    refetchMe: meQuery.refetch,
  });
  const { isRefreshing, refreshTeamState } = useTeamStateStream(
    queryClient,
    isAuthenticated,
  );
  const outletContext = useMemo<RootLayoutOutletContext>(
    () => ({
      currentUserId,
      currentTeamName,
      displayName: currentUserName,
      colorHex: currentUserColorHex,
    }),
    [currentTeamName, currentUserColorHex, currentUserId, currentUserName],
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

  if (isAuthChecking) {
    return (
      <main className="ios-safe-main min-h-screen bg-[color:var(--color-washi-50)] px-2 py-3 text-stone-700 md:p-6">
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
    return (
      <LoginCard
        status={status}
        onLogin={() => {
          void login();
        }}
      />
    );
  }

  return (
    <main className="ios-safe-main min-h-screen bg-[color:var(--color-washi-50)] px-2 py-2.5 pb-28 text-stone-800 md:p-8 md:pb-20">
      <StatusToast
        message={status}
        onDismiss={() => {
          setStatus("");
        }}
      />

      <div className="mx-auto max-w-6xl">
        <header className="rounded-xl border border-stone-200 bg-white/90 p-2.5 shadow-sm backdrop-blur md:rounded-2xl md:p-4">
          <div className="flex items-center justify-between gap-2 md:gap-3">
            <div className="min-w-0 flex-1 overflow-x-auto">
              <h1 className="whitespace-nowrap text-xl font-semibold tracking-normal md:text-2xl md:font-bold md:tracking-wide">
                {currentTeamName}
              </h1>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <span className="text-xs whitespace-nowrap text-stone-700 md:text-sm">
                {todayLabel}
              </span>
            </div>
          </div>
        </header>

        <Outlet context={outletContext} />
      </div>

      <FloatingNav
        currentUserName={currentUserName}
        currentUserColorHex={currentUserColorHex}
        onLogout={() => {
          void logoutAction();
        }}
        onRefresh={() => {
          void refreshTeamState();
        }}
        isRefreshing={isRefreshing}
      />
    </main>
  );
}
