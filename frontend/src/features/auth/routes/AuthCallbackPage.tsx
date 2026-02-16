import { type LoaderFunctionArgs, redirect } from "react-router-dom";

import { writeAccessToken } from "../../../lib/api/client";
import { postAuthSessionsExchange } from "../../../lib/api/generated/client";
import { formatError } from "../../../shared/utils/errors";
import { writeFlashStatus } from "../state/flash";

export async function authCallbackLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const exchangeCode = url.searchParams.get("exchangeCode");

  if (exchangeCode == null || exchangeCode === "") {
    writeFlashStatus("ログイン情報が見つかりませんでした");
    return redirect("/");
  }

  try {
    const res = await postAuthSessionsExchange({ exchangeCode });
    writeAccessToken(res.data.accessToken);
    writeFlashStatus("ログインしました");
  } catch (error) {
    writeFlashStatus(`ログインに失敗しました: ${formatError(error)}`);
  }

  return redirect("/");
}

export function AuthCallbackPage() {
  return (
    <main className="min-h-screen p-6 text-stone-700">
      <p>ログイン処理中です...</p>
    </main>
  );
}
