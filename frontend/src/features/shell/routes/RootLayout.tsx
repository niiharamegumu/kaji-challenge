import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useBootFlow } from "../../../app/boot";
import {
  preloadAdminInvitesPageChunk,
  preloadAdminPenaltiesPageChunk,
  preloadAdminSummaryPageChunk,
  preloadAdminTasksPageChunk,
  preloadReminderCalendarPageChunk,
  preloadShoppingListPageChunk,
} from "../../../app/route-chunks";
import { getTeamCurrentMembers } from "../../../lib/api/generated/client";
import { BootScreen } from "../../../shared/components/BootScreen";
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
import { prefetchHomeData } from "../../home/preload";
import { StatusToast } from "../components/StatusToast";
import { useAuthGate } from "../hooks/useAuthGate";
import { useCurrentUserProfile } from "../hooks/useCurrentUserProfile";
import { refreshTeamState as invalidateTeamState } from "../lib/teamStateRefresh";
import { statusMessageAtom } from "../state/status";

const FloatingNav = lazy(async () => {
  const module = await import("../components/FloatingNav");
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

export type RootLayoutOutletContext = {
  currentUserId: string | null;
  currentTeamName: string;
  displayName: string;
  colorHex: string | null;
};

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
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(now);
    const weekday = new Intl.DateTimeFormat("ja-JP", {
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

  const handleLoginSuccess = useCallback(() => {
    prefetchHomeDataOnce();
    refetchAfterLogin();
  }, [prefetchHomeDataOnce, refetchAfterLogin]);
  useExchangeCodeFallback(setSession, setStatus, handleLoginSuccess);

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
      void preloadAdminTasksPageChunk();
      void preloadAdminSummaryPageChunk();
      void preloadAdminPenaltiesPageChunk();
      void preloadAdminInvitesPageChunk();
      void preloadReminderCalendarPageChunk();
      void preloadShoppingListPageChunk();

      if (location.pathname !== "/") {
        prefetchHomeDataOnce();
      }
    });
  }, [
    isAuthenticated,
    isInitialBootPending,
    location.pathname,
    prefetchHomeDataOnce,
  ]);

  const handleRouteIntent = useCallback((path: string) => {
    switch (path) {
      case "/admin/tasks":
        void preloadAdminTasksPageChunk();
        break;
      case "/admin/summary":
        void preloadAdminSummaryPageChunk();
        break;
      case "/admin/penalties":
        void preloadAdminPenaltiesPageChunk();
        break;
      case "/admin/settings":
        void preloadAdminInvitesPageChunk();
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
        <header className="p-2.5 md:p-4">
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
