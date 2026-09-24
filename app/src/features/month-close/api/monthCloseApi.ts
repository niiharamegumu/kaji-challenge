import {
  getMonthCloseCandidate as requestMonthCloseCandidate,
  postMonthClose,
} from "../../../lib/api/operations";

export async function getMonthCloseCandidate() {
  return (await requestMonthCloseCandidate()).data;
}

export async function closeMonth(month: string) {
  return (await postMonthClose(month)).data;
}
