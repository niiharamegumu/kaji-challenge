import type { QueryClient } from "@tanstack/react-query";

import {
  getTaskOverview,
  listShoppingItems,
} from "../../lib/api/generated/client";
import { queryKeys } from "../../shared/query/queryKeys";

export function prefetchHomeData(queryClient: QueryClient) {
  return Promise.all([
    queryClient.ensureQueryData({
      queryKey: queryKeys.home,
      queryFn: async () => (await getTaskOverview()).data,
    }),
    queryClient.ensureQueryData({
      queryKey: queryKeys.shoppingItems,
      queryFn: async () => (await listShoppingItems()).data.items ?? [],
    }),
  ]);
}
