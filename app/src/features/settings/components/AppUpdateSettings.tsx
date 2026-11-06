import { useState } from "react";
import { checkForPWAUpdate } from "../../../app/pwa-register";

export function AppUpdateSettings() {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");

  async function check() {
    setChecking(true);
    setMessage("");
    try {
      const result = await checkForPWAUpdate();
      setMessage(
        {
          current: "最新バージョンです。",
          available: "新しいバージョンがあります。画面上部の「更新する」で適用できます。",
          unavailable: "この環境ではアプリの更新を確認できません。",
        }[result],
      );
    } catch {
      setMessage("更新を確認できませんでした。通信状態を確認して、もう一度お試しください。");
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium text-body">アプリの更新</h3>
      <p className="text-sm leading-relaxed text-secondary">
        最新バージョンを確認して、新しい機能や改善を受け取れます。
      </p>
      <button
        type="button"
        disabled={checking}
        onClick={() => void check()}
        className="min-h-11 cursor-pointer rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-body transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        アップデートを確認
      </button>
      <p role="status" className="text-xs text-muted">
        {checking ? "確認中…" : message}
      </p>
    </section>
  );
}
