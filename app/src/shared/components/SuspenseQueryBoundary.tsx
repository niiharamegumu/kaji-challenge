import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { type ReactNode, Suspense } from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";

import { useBootFlow, useMarkInitialScreenReady } from "../../app/boot";
import { BootScreen } from "./BootScreen";

type BoundaryProps = {
  errorMessage: string;
  fullScreenOnInitial?: boolean;
};

type SuspenseQueryBoundaryProps = {
  children: ReactNode;
  errorMessage: string;
  fullScreenOnInitial?: boolean;
  loadingFallback?: ReactNode;
};

function BoundaryFallback({
  resetErrorBoundary,
  errorMessage,
  fullScreenOnInitial,
}: FallbackProps & BoundaryProps) {
  const { isInitialBootPending } = useBootFlow();
  const shouldUseFullScreen = fullScreenOnInitial && isInitialBootPending;

  useMarkInitialScreenReady();

  if (shouldUseFullScreen) {
    return <BootScreen />;
  }

  return (
    <section className="mt-4 rounded-xl border border-danger-line bg-danger-soft p-4 text-danger-strong">
      <p className="text-sm font-medium">{errorMessage}</p>
      <button
        type="button"
        className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg border border-danger-line bg-surface px-3 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger-hover"
        onClick={resetErrorBoundary}
      >
        再試行
      </button>
    </section>
  );
}

export function SuspenseQueryBoundary({
  children,
  errorMessage,
  fullScreenOnInitial = false,
  loadingFallback,
}: SuspenseQueryBoundaryProps) {
  const { isInitialBootPending } = useBootFlow();
  const shouldUseFullScreen = fullScreenOnInitial && isInitialBootPending;
  const resolvedLoadingFallback = shouldUseFullScreen ? (
    <BootScreen />
  ) : (
    (loadingFallback ?? (
      <div className="mt-4 flex justify-center">
        <LoaderCircle
          size={22}
          className="text-muted animate-spin motion-reduce:animate-none"
          aria-label="読み込み中"
          role="status"
        />
      </div>
    ))
  );

  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          onReset={reset}
          fallbackRender={(props) => (
            <BoundaryFallback
              {...props}
              errorMessage={errorMessage}
              fullScreenOnInitial={fullScreenOnInitial}
            />
          )}
        >
          <Suspense fallback={resolvedLoadingFallback}>{children}</Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
