import { QueryClientProvider } from "@tanstack/react-query";
import { Provider as JotaiProvider } from "jotai";
import type { PropsWithChildren } from "react";

import { appQueryClient } from "../shared/query/queryClient";
import { BootFlowProvider } from "./boot";
import { MutationFeedback } from "../shared/components/MutationFeedback";

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <BootFlowProvider>
      <JotaiProvider>
        <QueryClientProvider client={appQueryClient}>
          {children}
          <MutationFeedback />
        </QueryClientProvider>
      </JotaiProvider>
    </BootFlowProvider>
  );
}
