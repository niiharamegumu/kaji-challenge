import { QueryClientProvider } from "@tanstack/react-query";
import { Provider as JotaiProvider } from "jotai";
import type { PropsWithChildren } from "react";

import { appQueryClient } from "../shared/query/queryClient";

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <JotaiProvider>
      <QueryClientProvider client={appQueryClient}>
        {children}
      </QueryClientProvider>
    </JotaiProvider>
  );
}
