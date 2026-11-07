import type { QueryClient } from "@tanstack/react-query";
import {
  sharedPageQueryOptions,
  sharedPagesQueryOptions,
} from "../../shared/query/sharedPageQueries";

// Matches the two-column layout in shared-pages.css.
export const sharedPageSidebarMedia = "(min-width: 768px)";

export async function prefetchSharedPageData(client: QueryClient, pageId: string) {
  await Promise.all([
    !pageId || window.matchMedia(sharedPageSidebarMedia).matches
      ? client.prefetchQuery(sharedPagesQueryOptions)
      : undefined,
    pageId && pageId !== "new" ? client.prefetchQuery(sharedPageQueryOptions(pageId)) : undefined,
  ]);
}
