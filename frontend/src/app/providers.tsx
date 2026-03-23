import { QueryClientProvider } from "@tanstack/react-query";
import { Provider as JotaiProvider } from "jotai";
import type { PropsWithChildren } from "react";

import { appQueryClient } from "../shared/query/queryClient";
import { BootFlowProvider } from "./boot";

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <BootFlowProvider>
      <JotaiProvider>
        <QueryClientProvider client={appQueryClient}>
          {children}
        </QueryClientProvider>
      </JotaiProvider>
    </BootFlowProvider>
  );
}
