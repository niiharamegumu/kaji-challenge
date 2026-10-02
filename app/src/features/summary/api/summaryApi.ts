import { postTaskCompletion, type TaskCompletionRequest } from "../../../lib/api/operations";

export function updatePastTaskCompletion(taskId: string, body: TaskCompletionRequest) {
  return postTaskCompletion(taskId, body);
}
