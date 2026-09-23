import { useEffect } from "react";
import { useNavigate } from "../../../shared/router/navigation";
import { useMarkInitialScreenReady } from "../../../app/boot";
import { BootScreen } from "../../../shared/components/BootScreen";
import { authClient } from "../api/authClient";
import { writeFlashStatus } from "../state/flash";
export async function authCallbackLoader({ request }: { request: Request }) {
  const error = new URL(request.url).searchParams.get("error");
  if (error) {
    writeFlashStatus(
      error === "signup_forbidden"
        ? "このアカウントは現在の招待制リリース対象外です。"
        : "ログインに失敗しました。再度ログインしてください。",
    );
  } else {
    try {
      const result = await authClient.getSession();
      if (result.error || !result.data) throw new Error("Missing session");
      writeFlashStatus("ログインしました", "login_success");
    } catch {
      writeFlashStatus("ログインに失敗しました。再度ログインしてください。");
    }
  }
  return new Response(null, { status: 302, headers: { Location: "/" } });
}
export function AuthCallbackPage() {
  useMarkInitialScreenReady();
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    void authCallbackLoader({ request: new Request(window.location.href) }).then(() => {
      if (active) navigate("/", { replace: true });
    });
    return () => {
      active = false;
    };
  }, [navigate]);
  return <BootScreen />;
}
