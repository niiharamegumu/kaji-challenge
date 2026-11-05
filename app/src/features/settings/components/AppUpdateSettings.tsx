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
    <section className="mt-5 space-y-2">
      <h3 className="text-sm font-medium text-body">アプリの更新</h3>
      <button
        type="button"
        disabled={checking}
        onClick={() => void check()}
        className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-body hover:bg-surface-muted disabled:opacity-60"
      >
        アップデートを確認
      </button>
      <p role="status" className="text-xs text-muted">
        {checking ? "確認中…" : message}
      </p>
    </section>
  );
}
