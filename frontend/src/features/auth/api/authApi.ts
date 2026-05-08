import { postAuthSessionsExchange } from "../../../lib/api/generated/client";

export async function exchangeSession(exchangeCode: string) {
  await postAuthSessionsExchange({ exchangeCode });
}
