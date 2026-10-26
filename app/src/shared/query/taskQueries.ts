import { queryOptions } from "@tanstack/react-query";
import { listTasks } from "../../lib/api/operations";
import { queryKeys } from "./queryKeys";

export const tasksQueryOptions = queryOptions({
  queryKey: queryKeys.tasks,
  queryFn: async ({ signal }) => (await listTasks(undefined, { signal })).data.items,
});
