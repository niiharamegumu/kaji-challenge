import type { QueryClient } from "@tanstack/react-query";

import {
  homeQueryOptions,
  homeShoppingItemsQueryOptions,
} from "./hooks/useHomeQueries";

export function prefetchHomeData(queryClient: QueryClient) {
  return Promise.all([
    queryClient.ensureQueryData(homeQueryOptions),
    queryClient.ensureQueryData(homeShoppingItemsQueryOptions),
  ]);
}
