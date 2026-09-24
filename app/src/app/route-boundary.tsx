import type { ReactNode } from "react";
import { SuspenseQueryBoundary } from "../shared/components/SuspenseQueryBoundary";
import { InitialViewReady } from "./boot";
export const withDataBoundary = (
  element: ReactNode,
  errorMessage: string,
  options?: {
    fullScreenOnInitial?: boolean;
    loadingFallback?: ReactNode;
  },
) => (
  <SuspenseQueryBoundary
    errorMessage={errorMessage}
    fullScreenOnInitial={options?.fullScreenOnInitial}
    loadingFallback={options?.loadingFallback}
  >
    <InitialViewReady>{element}</InitialViewReady>
  </SuspenseQueryBoundary>
);
