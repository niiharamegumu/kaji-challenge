import { ConnectedMembers } from "../../features/shell/components/ConnectedMembers";
import { useTeamRealtime } from "../../features/shell/hooks/useTeamRealtime";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "../../shared/router/navigation";

import {
  consumeFlashStatus,
  LoginCard,
  useLoginAction,
  useLogoutAction,
  useMeQuery,
} from "../../features/auth";
import { prefetchHomeData } from "../../features/home/preload";
import { MonthCloseBanner } from "../../features/month-close";
import { listCurrentTeamMembers } from "../../features/shell/api/teamMembersApi";
import { StatusToast } from "../../features/shell/components/StatusToast";
import { useAuthGate } from "../../features/shell/hooks/useAuthGate";
import { useCurrentUserProfile } from "../../features/shell/hooks/useCurrentUserProfile";
import { BootScreen } from "../../shared/components/BootScreen";
import { queryKeys } from "../../shared/query/queryKeys";
import { refreshTeamState as invalidateTeamState } from "../../shared/query/teamStateRefresh";
import {
  RootLayoutContext,
  type RootLayoutOutletContext,
} from "../../shared/router/rootLayoutContext";
import { statusMessageAtom } from "../../shared/state/status";
import { isLoggedInAtom, sessionAtom } from "../../state/session";
import { useBootFlow } from "../boot";
import {
  preloadSettingsPageChunk,
  preloadPenaltiesPageChunk,
  preloadSummaryPageChunk,
  preloadTasksPageChunk,
  preloadReminderCalendarPageChunk,
  preloadShoppingListPageChunk,
} from "../route-chunks";

const FloatingNav = lazy(async () => {
  const module = await import("../../features/shell/components/FloatingNav");
  return { default: module.FloatingNav };
});

const idlePreloadDelayMs = 1200;

function scheduleIdleWork(work: () => void) {
  if (typeof globalThis === "undefined") {
    return () => {};
  }

  if (
    typeof globalThis.requestIdleCallback === "function" &&
    typeof globalThis.cancelIdleCallback === "function"
  ) {
    const callbackId = globalThis.requestIdleCallback(() => {
      work();
    });
    return () => {
      if (typeof globalThis.cancelIdleCallback === "function") {
        globalThis.cancelIdleCallback(callbackId);
      }
    };
  }

  const timeoutId = globalThis.setTimeout(work, idlePreloadDelayMs);
  return () => globalThis.clearTimeout(timeoutId);
}

export function RootLayout() {
  const { isInitialBootPending, markAuthResolved } = useBootFlow();
  const homeDataPrefetchedRef = useRef(false);
  const queryClient = useQueryClient();
  const [, setSession] = useAtom(sessionAtom);
  const [status, setStatus] = useAtom(statusMessageAtom);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const loggedIn = useAtomValue(isLoggedInAtom);
  const navigate = useNavigate();
  const location = useLocation();

  const meQuery = useMeQuery(true);
  const cachedMembersQuery = useQuery({
    queryKey: queryKeys.teamMembers,
    queryFn: listCurrentTeamMembers,
    enabled: meQuery.isSuccess,
  });
  const login = useLoginAction(setStatus);
  const logoutAction = useLogoutAction(setStatus, setSession);
  const { currentUserId, currentTeamName, currentUserName, currentUserColorHex } =
    useCurrentUserProfile(meQuery.data, cachedMembersQuery.data);
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
  const realtime = useTeamRealtime(
    isAuthenticated ? meQuery.data?.memberships[0]?.teamId : undefined,
    currentUserId,
  );
  const refreshTeamState = useCallback(async () => {
    if (!isAuthenticated) {
      return;
    }

    setIsRefreshing(true);
    try {
      await invalidateTeamState(queryClient);
    } finally {
      setIsRefreshing(false);
    }
  }, [isAuthenticated, queryClient]);
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
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(now);
    const weekday = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      weekday: "short",
    }).format(now);
    return `${fullDate}（${weekday}）`;
  }, []);
  const prefetchHomeDataOnce = useCallback(() => {
    if (homeDataPrefetchedRef.current) {
      return;
    }
    homeDataPrefetchedRef.current = true;
    void prefetchHomeData(queryClient);
  }, [queryClient]);

  useEffect(() => {
    const flash = consumeFlashStatus();
    if (flash != null) {
      setStatus(flash.message);
      if (flash.kind === "login_success") {
        prefetchHomeDataOnce();
        refetchAfterLogin();
      }
    }
  }, [prefetchHomeDataOnce, refetchAfterLogin, setStatus]);

  useEffect(() => {
    if (!isAuthChecking) {
      markAuthResolved();
    }
  }, [isAuthChecking, markAuthResolved]);

  useEffect(() => {
    if (!isAuthenticated) {
      homeDataPrefetchedRef.current = false;
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (location.pathname === "/" && meQuery.isSuccess) {
      prefetchHomeDataOnce();
    }
  }, [location.pathname, meQuery.isSuccess, prefetchHomeDataOnce]);

  useEffect(() => {
    if (!isAuthenticated || isInitialBootPending) {
      return;
    }

    return scheduleIdleWork(() => {
      void preloadTasksPageChunk();
      void preloadSummaryPageChunk();
      void preloadPenaltiesPageChunk();
      void preloadSettingsPageChunk();
      void preloadReminderCalendarPageChunk();
      void preloadShoppingListPageChunk();

      if (location.pathname !== "/") {
        prefetchHomeDataOnce();
      }
    });
  }, [isAuthenticated, isInitialBootPending, location.pathname, prefetchHomeDataOnce]);

  const handleRouteIntent = useCallback((path: string) => {
    switch (path) {
      case "/tasks":
        void preloadTasksPageChunk();
        break;
      case "/summary":
        void preloadSummaryPageChunk();
        break;
      case "/penalties":
        void preloadPenaltiesPageChunk();
        break;
      case "/settings":
        void preloadSettingsPageChunk();
        break;
      case "/calendar":
        void preloadReminderCalendarPageChunk();
        break;
      case "/shopping-list":
        void preloadShoppingListPageChunk();
        break;
      default:
        break;
    }
  }, []);

  if (isAuthChecking) {
    return <BootScreen />;
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
    <main className="ios-safe-main min-h-screen bg-[color:var(--color-washi-50)] px-2 py-2.5 pb-36 text-stone-800 md:px-8 md:pt-8 md:pb-44">
      <StatusToast
        message={status}
        onDismiss={() => {
          setStatus("");
        }}
      />

      <div className="mx-auto max-w-6xl">
        <header className="flex items-start justify-between gap-3 p-2.5 md:items-center md:p-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 md:flex-row md:items-center md:justify-between md:gap-3">
            <h1
              title={currentTeamName}
              className="min-w-0 truncate text-xl font-semibold tracking-normal md:text-2xl md:font-bold md:tracking-wide"
            >
              {currentTeamName}
            </h1>
            <span className="shrink-0 whitespace-nowrap text-xs text-stone-700 md:text-sm">
              {todayLabel}
            </span>
          </div>
          <ConnectedMembers
            members={cachedMembersQuery.data ?? []}
            userIds={realtime.userIds}
            connected={realtime.connected}
          />
        </header>

        <MonthCloseBanner />

        <RootLayoutContext value={outletContext}>
          <Outlet />
        </RootLayoutContext>
      </div>

      {!isInitialBootPending ? (
        <Suspense fallback={null}>
          <FloatingNav
            currentUserName={currentUserName}
            currentUserColorHex={currentUserColorHex}
            isRefreshing={isRefreshing}
            onRouteIntent={handleRouteIntent}
            onLogout={() => {
              void logoutAction();
            }}
            onRefresh={() => {
              void refreshTeamState();
            }}
          />
        </Suspense>
      ) : null}
    </main>
  );
}
