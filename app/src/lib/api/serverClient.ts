import type { z } from "zod";
import { responseSchemas, type Operation } from "../../contracts/operations";
import { invokeOperation } from "../../server/transport/operations.functions";
import type { ApiRequestError } from "./api-client-state";
export interface ApiResult<T> {
  data: T;
  status: number;
  headers: Headers;
}
export type CallOptions = Pick<RequestInit, "signal">;

// チームを離れた後のレスポンスを旧チームのキャッシュへ反映しない。更新の再送はしない。
let teamRequests = new AbortController();
export function cancelTeamRequests() {
  teamRequests.abort();
  teamRequests = new AbortController();
}

export async function callOperation<Name extends Operation["operation"]>(
  operation: Name,
  data: { params: unknown; body?: unknown },
  status: number,
  options: CallOptions | undefined,
): Promise<ApiResult<z.output<(typeof responseSchemas)[Name]>>> {
  const signal =
    operation === "getMe"
      ? options?.signal
      : AbortSignal.any([teamRequests.signal, ...(options?.signal ? [options.signal] : [])]);
  signal?.throwIfAborted();
  const result = await invokeOperation({
    data: { operation, ...data },
    signal: signal ?? undefined,
  });
  signal?.throwIfAborted();
  if (!result.ok) throw { name: "ApiRequestError", ...result.error } satisfies ApiRequestError;
  return {
    data: responseSchemas[operation].parse(result.data) as z.output<(typeof responseSchemas)[Name]>,
    status,
    headers: new Headers(),
  };
}
