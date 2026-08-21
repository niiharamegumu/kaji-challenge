import {
  getAdminMonthCloseCandidate,
  postAdminMonthClose,
} from "../../../lib/api/generated/client";

export async function getMonthCloseCandidate() {
  return (await getAdminMonthCloseCandidate()).data;
}

export async function closeMonth(month: string) {
  return (await postAdminMonthClose(month)).data;
}
