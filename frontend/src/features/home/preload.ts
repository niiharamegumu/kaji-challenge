import type { QueryClient } from "@tanstack/react-query";

import { getTaskOverview } from "../../lib/api/generated/client";
import { queryKeys } from "../../shared/query/queryKeys";

let homePageChunkPromise:
  | Promise<typeof import("./routes/HomePage")>
  | undefined;

export function preloadHomePageChunk() {
  homePageChunkPromise ??= import("./routes/HomePage");
  return homePageChunkPromise;
}

export function prefetchHomeData(queryClient: QueryClient) {
  return queryClient.prefetchQuery({
    queryKey: queryKeys.home,
    queryFn: async () => (await getTaskOverview()).data,
  });
}
