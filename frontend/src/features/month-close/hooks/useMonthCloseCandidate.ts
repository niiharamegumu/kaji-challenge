import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { queryKeys } from "../../../shared/query/queryKeys";
import { getMonthCloseCandidate } from "../api/monthCloseApi";

const millisecondsUntilNextJSTDay = () => {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const next = Date.UTC(
    jst.getUTCFullYear(),
    jst.getUTCMonth(),
    jst.getUTCDate() + 1,
  );
  return Math.max(1_000, next - jst.getTime());
};

export function useMonthCloseCandidate() {
  const query = useQuery({
    queryKey: queryKeys.monthCloseCandidate,
    queryFn: getMonthCloseCandidate,
    refetchOnWindowFocus: true,
  });
  const refetch = query.refetch;

  useEffect(() => {
    let timer = 0;
    let active = true;
    const schedule = () => {
      timer = window.setTimeout(() => {
        void refetch().finally(() => {
          if (active) {
            schedule();
          }
        });
      }, millisecondsUntilNextJSTDay());
    };
    schedule();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [refetch]);

  return query;
}
