import { todoCategoriesQueryOptions } from "../../shared/query/todoQueries";
import type { QueryClient } from "@tanstack/react-query";
import { penaltyRulesWithDeletedQueryOptions } from "../../shared/query/monthlyPenaltyQueries";
import {
  homeQueryOptions,
  homeTodoItemsQueryOptions,
  previousMonthPenaltySummaryQueryOptions,
} from "./hooks/useHomeQueries";

export function prefetchHomeData(queryClient: QueryClient) {
  return Promise.all([
    queryClient.prefetchQuery(todoCategoriesQueryOptions),
    queryClient.prefetchQuery(homeQueryOptions),
    queryClient.prefetchQuery(homeTodoItemsQueryOptions),
    queryClient.prefetchQuery(previousMonthPenaltySummaryQueryOptions()),
    queryClient.prefetchQuery(penaltyRulesWithDeletedQueryOptions),
  ]);
}
