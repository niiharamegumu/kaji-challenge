import type { QueryClient } from "@tanstack/react-query";
import { penaltyRulesWithDeletedQueryOptions } from "../../shared/query/monthlyPenaltyQueries";
import {
  homeQueryOptions,
  homeTodoItemsQueryOptions,
  previousMonthPenaltySummaryQueryOptions,
} from "./hooks/useHomeQueries";

export function prefetchHomeData(queryClient: QueryClient) {
  return Promise.all([
    queryClient.ensureQueryData(homeQueryOptions),
    queryClient.ensureQueryData(homeTodoItemsQueryOptions),
    queryClient.ensureQueryData(previousMonthPenaltySummaryQueryOptions()),
    queryClient.ensureQueryData(penaltyRulesWithDeletedQueryOptions),
  ]);
}
