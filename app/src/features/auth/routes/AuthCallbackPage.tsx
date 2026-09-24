import { useEffect } from "react";
import { useNavigate, useSearchParams } from "../../../shared/router/navigation";
import { useBootFlow, useMarkInitialScreenReady } from "../../../app/boot";
import { BootScreen } from "../../../shared/components/BootScreen";
import { authClient } from "../api/authClient";
import { writeFlashStatus } from "../state/flash";
export async function authCallbackLoader() {
  try {
    const result = await authClient.getSession();
    if (result.error || !result.data) throw new Error("Missing session");
    writeFlashStatus("ログインしました", "login_success");
  } catch {
    writeFlashStatus("ログインに失敗しました。再度ログインしてください。");
  }
  return new Response(null, { status: 302, headers: { Location: "/" } });
}
export function AuthCallbackPage() {
  useMarkInitialScreenReady();
  const { markAuthResolved } = useBootFlow();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const error = searchParams.get("error");
  useEffect(() => {
    if (error) markAuthResolved();
  }, [error, markAuthResolved]);
  useEffect(() => {
    if (error) return;
    let active = true;
    void authCallbackLoader().then(() => {
      if (active) navigate("/", { replace: true });
    });
    return () => {
      active = false;
    };
  }, [error, navigate]);
  if (error)
    return (
      <main className="ios-safe-main flex min-h-screen items-center justify-center bg-[color:var(--color-washi-50)] px-4 py-8 text-stone-800">
        <section className="w-full max-w-lg rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
          <img src="/icons/pwa-192x192.png" alt="" width={64} height={64} className="h-12 w-12" />
          <p className="mt-4 text-sm font-semibold text-stone-600">KajiChalle</p>
          <h1 className="mt-2 text-2xl font-bold text-stone-900">ログインできませんでした</h1>
          <p className="mt-4 text-sm leading-7 text-stone-700">
            {error === "signup_forbidden"
              ? "このアカウントは現在の利用対象に登録されていません。利用を希望する場合は管理者にお問い合わせください。"
              : "ログイン処理を完了できませんでした。もう一度お試しください。"}
          </p>
          <a
            href="/"
            className="mt-8 inline-flex min-h-11 items-center justify-center rounded-lg bg-stone-900 px-5 py-2 text-sm font-semibold text-white hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2"
          >
            ログイン画面に戻る
          </a>
        </section>
      </main>
    );
  return <BootScreen />;
}
