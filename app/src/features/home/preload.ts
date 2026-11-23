import type { QueryClient } from "@tanstack/react-query";
import { penaltyRulesWithDeletedQueryOptions } from "../../shared/query/monthlyPenaltyQueries";
import { homeQueryOptions, previousMonthPenaltySummaryQueryOptions } from "./hooks/useHomeQueries";

export function prefetchHomeData(queryClient: QueryClient) {
  return Promise.all([
    queryClient.prefetchQuery(homeQueryOptions),
    queryClient.prefetchQuery(previousMonthPenaltySummaryQueryOptions()),
    queryClient.prefetchQuery(penaltyRulesWithDeletedQueryOptions),
  ]);
}
