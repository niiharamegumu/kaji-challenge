import {
  getMonthCloseCandidate as requestMonthCloseCandidate,
  postMonthClose,
} from "../../../lib/api/operations";

export async function getMonthCloseCandidate(signal?: AbortSignal) {
  return (await requestMonthCloseCandidate({ signal })).data;
}

export async function closeMonth(month: string) {
  return (await postMonthClose(month)).data;
}
