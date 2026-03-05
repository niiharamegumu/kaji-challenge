import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { type ReactNode, Suspense } from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";

type BoundaryProps = {
  errorMessage: string;
};

type SuspenseQueryBoundaryProps = {
  children: ReactNode;
  errorMessage: string;
};

function BoundaryFallback({
  resetErrorBoundary,
  errorMessage,
}: FallbackProps & BoundaryProps) {
  return (
    <section className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
      <p className="text-sm font-medium">{errorMessage}</p>
      <button
        type="button"
        className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100"
        onClick={resetErrorBoundary}
      >
        再試行
      </button>
    </section>
  );
}

const loadingFallback = (
  <div className="mt-4 flex justify-center">
    <LoaderCircle
      size={22}
      className="text-stone-500 animate-spin motion-reduce:animate-none"
      aria-label="読み込み中"
      role="status"
    />
  </div>
);

export function SuspenseQueryBoundary({
  children,
  errorMessage,
}: SuspenseQueryBoundaryProps) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          onReset={reset}
          fallbackRender={(props) => (
            <BoundaryFallback {...props} errorMessage={errorMessage} />
          )}
        >
          <Suspense fallback={loadingFallback}>{children}</Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
