import type { QueryClient } from "@tanstack/react-query";

import { getTaskOverview } from "../../lib/api/generated/client";
import { queryKeys } from "../../shared/query/queryKeys";

export function prefetchHomeData(queryClient: QueryClient) {
  return queryClient.ensureQueryData({
    queryKey: queryKeys.home,
    queryFn: async () => (await getTaskOverview()).data,
  });
}
