import { queryOptions } from "@tanstack/react-query";
import { getSharedPage, listSharedPages } from "../../lib/api/operations";
import { queryKeys } from "./queryKeys";

export const sharedPagesQueryOptions = queryOptions({
  queryKey: queryKeys.sharedPages,
  queryFn: async ({ signal }) => (await listSharedPages({ signal })).data.items,
});

export const sharedPageQueryOptions = (pageId: string) =>
  queryOptions({
    queryKey: [...queryKeys.sharedPages, pageId],
    queryFn: async ({ signal }) => (await getSharedPage(pageId, { signal })).data,
  });
