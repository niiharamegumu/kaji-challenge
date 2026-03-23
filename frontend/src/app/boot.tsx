import {
  type PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const bootMarks = {
  htmlSplashVisible: "boot:html-splash-visible",
  reactMounted: "boot:react-mounted",
  authResolved: "boot:auth-resolved",
  initialReady: "boot:initial-ready",
} as const;

type BootMarkName = (typeof bootMarks)[keyof typeof bootMarks];

type BootContextValue = {
  isInitialBootPending: boolean;
  markReactMounted: () => void;
  markAuthResolved: () => void;
  markInitialScreenReady: () => void;
};

const BootContext = createContext<BootContextValue | null>(null);

function markPerformance(name: BootMarkName) {
  if (typeof performance === "undefined") {
    return;
  }
  if (performance.getEntriesByName(name, "mark").length > 0) {
    return;
  }
  performance.mark(name);
}

function reportBootMetrics() {
  if (!import.meta.env.DEV || typeof performance === "undefined") {
    return;
  }

  const htmlSplashVisible = performance.getEntriesByName(
    bootMarks.htmlSplashVisible,
    "mark",
  )[0];
  if (htmlSplashVisible == null) {
    return;
  }

  const summary = {
    reactMounted: Math.round(
      (performance.getEntriesByName(bootMarks.reactMounted, "mark")[0]
        ?.startTime ?? htmlSplashVisible.startTime) -
        htmlSplashVisible.startTime,
    ),
    authResolved: Math.round(
      (performance.getEntriesByName(bootMarks.authResolved, "mark")[0]
        ?.startTime ?? htmlSplashVisible.startTime) -
        htmlSplashVisible.startTime,
    ),
    initialReady: Math.round(
      (performance.getEntriesByName(bootMarks.initialReady, "mark")[0]
        ?.startTime ?? htmlSplashVisible.startTime) -
        htmlSplashVisible.startTime,
    ),
  };

  console.info("[boot] timings (ms)", summary);
}

function hideBootSplash() {
  if (typeof document === "undefined") {
    return;
  }

  const splash = document.getElementById("boot-splash");
  if (splash == null || splash.dataset.state === "hidden") {
    return;
  }

  splash.dataset.state = "hidden";
  splash.classList.add("boot-splash--fade");

  const remove = () => {
    splash.remove();
  };

  splash.addEventListener("transitionend", remove, { once: true });
  window.setTimeout(remove, 220);
}

export function BootFlowProvider({ children }: PropsWithChildren) {
  const [isInitialBootPending, setIsInitialBootPending] = useState(true);
  const reactMountedRef = useRef(false);
  const authResolvedRef = useRef(false);
  const initialReadyRef = useRef(false);

  const completeInitialBootIfReady = useCallback(() => {
    if (!reactMountedRef.current || !authResolvedRef.current) {
      return;
    }

    hideBootSplash();
    setIsInitialBootPending(false);
  }, []);

  const markReactMounted = useCallback(() => {
    if (reactMountedRef.current) {
      return;
    }
    reactMountedRef.current = true;
    markPerformance(bootMarks.reactMounted);
    completeInitialBootIfReady();
  }, [completeInitialBootIfReady]);

  const markAuthResolved = useCallback(() => {
    if (authResolvedRef.current) {
      return;
    }
    authResolvedRef.current = true;
    markPerformance(bootMarks.authResolved);
    completeInitialBootIfReady();
  }, [completeInitialBootIfReady]);

  const markInitialScreenReady = useCallback(() => {
    if (initialReadyRef.current) {
      return;
    }
    initialReadyRef.current = true;
    markPerformance(bootMarks.initialReady);
    reportBootMetrics();
  }, []);

  const value = useMemo<BootContextValue>(
    () => ({
      isInitialBootPending,
      markReactMounted,
      markAuthResolved,
      markInitialScreenReady,
    }),
    [
      isInitialBootPending,
      markReactMounted,
      markAuthResolved,
      markInitialScreenReady,
    ],
  );

  return <BootContext.Provider value={value}>{children}</BootContext.Provider>;
}

export function useBootFlow() {
  const context = useContext(BootContext);
  if (context == null) {
    throw new Error("useBootFlow must be used within BootFlowProvider");
  }
  return context;
}

export function useMarkInitialScreenReady() {
  const { markInitialScreenReady } = useBootFlow();

  useEffect(() => {
    markInitialScreenReady();
  }, [markInitialScreenReady]);
}

export function InitialViewReady({ children }: PropsWithChildren) {
  useMarkInitialScreenReady();
  return <>{children}</>;
}
