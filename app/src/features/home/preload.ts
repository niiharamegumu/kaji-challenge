import type { QueryClient } from "@tanstack/react-query";
import { penaltyRulesWithDeletedQueryOptions } from "../../shared/query/monthlyPenaltyQueries";
import {
  homeQueryOptions,
  homeShoppingItemsQueryOptions,
  previousMonthPenaltySummaryQueryOptions,
} from "./hooks/useHomeQueries";

export function prefetchHomeData(queryClient: QueryClient) {
  return Promise.all([
    queryClient.ensureQueryData(homeQueryOptions),
    queryClient.ensureQueryData(homeShoppingItemsQueryOptions),
    queryClient.ensureQueryData(previousMonthPenaltySummaryQueryOptions()),
    queryClient.ensureQueryData(penaltyRulesWithDeletedQueryOptions),
  ]);
}
