import { type LoaderFunctionArgs, redirect } from "react-router-dom";

import { postAuthSessionsExchange } from "../../../lib/api/generated/client";
import { formatError } from "../../../shared/utils/errors";
import { writeFlashStatus } from "../state/flash";

export async function authCallbackLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const exchangeCode = url.searchParams.get("exchangeCode");
  const errorCode = url.searchParams.get("errorCode");

  if (exchangeCode == null || exchangeCode === "") {
    if (errorCode != null && errorCode !== "") {
      writeFlashStatus(authCallbackErrorMessage(errorCode));
      return redirect("/");
    }
    writeFlashStatus("ログイン情報が見つかりませんでした");
    return redirect("/");
  }

  try {
    await postAuthSessionsExchange({ exchangeCode });
    writeFlashStatus("ログインしました", "login_success");
  } catch (error) {
    writeFlashStatus(`ログインに失敗しました: ${formatError(error)}`);
  }

  return redirect("/");
}

function authCallbackErrorMessage(errorCode: string) {
  switch (errorCode) {
    case "signup_forbidden":
      return "このアカウントは現在の招待制リリース対象外です。";
    case "oidc_identity_mismatch":
      return "アカウント連携情報が一致しません。サポートに連絡してください。";
    case "unauthorized":
      return "認証に失敗しました。再度ログインしてください。";
    default:
      return "ログインに失敗しました。";
  }
}

export function AuthCallbackPage() {
  return (
    <main className="min-h-screen px-2 py-4 text-stone-700 md:p-6">
      <p>ログイン処理中です...</p>
    </main>
  );
}
