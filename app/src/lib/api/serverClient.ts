import type { z } from "zod";
import { responseSchemas, type Operation, type TeamState } from "../../contracts/operations";
import { invokeOperation } from "../../server/transport/operations.functions";
import {
  getLatestTeamEtag,
  getTeamStateGeneration,
  setLatestTeamEtag,
  type ApiRequestError,
} from "./api-client-state";
export interface ApiResult<T> {
  data: T;
  status: number;
  headers: Headers;
}
export type CallOptions = Pick<RequestInit, "signal">;
function readState(): TeamState | undefined {
  const match = /^W\/"team:([^:]+):rev:(\d+)"$/.exec(getLatestTeamEtag());
  return match ? { teamId: match[1], revision: match[2] } : undefined;
}
function etag(state: TeamState) {
  return `W/"team:${state.teamId}:rev:${state.revision}"`;
}
let writeQueue = {
  generation: getTeamStateGeneration(),
  tail: Promise.resolve<unknown>(undefined),
};

export function callOperation<Name extends Operation["operation"]>(
  operation: Name,
  data: { params: unknown; body?: unknown },
  status: number,
  requiresState: boolean,
  options: CallOptions | undefined,
): Promise<ApiResult<z.output<(typeof responseSchemas)[Name]>>> {
  const generation = getTeamStateGeneration();
  const run = () => sendOperation(operation, data, status, requiresState, options, generation);
  if (!requiresState) return run();
  // 次の書き込みは直前の応答のrevisionを使う。読取は並列のままにする。
  // ログアウト前の通信が未完了でも、新しいセッションの操作を待たせない。
  if (writeQueue.generation !== generation) {
    writeQueue = { generation, tail: Promise.resolve(undefined) };
  }
  const request = writeQueue.tail.then(run);
  writeQueue.tail = request.catch(() => undefined);
  return request;
}

async function sendOperation<Name extends Operation["operation"]>(
  operation: Name,
  data: { params: unknown; body?: unknown },
  status: number,
  requiresState: boolean,
  options: CallOptions | undefined,
  generation: number,
): Promise<ApiResult<z.output<(typeof responseSchemas)[Name]>>> {
  const signal = options?.signal;
  signal?.throwIfAborted();
  if (generation !== getTeamStateGeneration())
    throw new DOMException("Session changed", "AbortError");
  const expectedState = requiresState ? readState() : undefined;
  if (requiresState && !expectedState)
    throw {
      name: "ApiRequestError",
      status: 428,
      code: "precondition_required",
      message: "最新状態の取得が必要です。画面を更新して再操作してください。",
    } satisfies ApiRequestError;
  const result = await invokeOperation({
    data: { operation, ...data, expectedState },
    signal: signal ?? undefined,
  });
  // A transport may still resolve after cancellation. Do not restore stale team state.
  signal?.throwIfAborted();
  if (generation !== getTeamStateGeneration())
    throw new DOMException("Session changed", "AbortError");
  if (!result.ok) {
    const { error } = result;
    if (error.currentState) setLatestTeamEtag(etag(error.currentState));
    throw {
      name: "ApiRequestError",
      status: error.status,
      code: error.code,
      message: error.message,
      currentEtag: error.currentState ? etag(error.currentState) : undefined,
    } satisfies ApiRequestError;
  }
  // Validate before advancing the revision so an invalid response cannot change client state.
  const dataValue = responseSchemas[operation].parse(result.data) as z.output<
    (typeof responseSchemas)[Name]
  >;
  const value = etag(result.state);
  setLatestTeamEtag(value);
  return {
    data: dataValue,
    status,
    headers: new Headers({ ETag: value }),
  };
}
