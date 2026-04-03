import { useSetAtom } from "jotai";

import { statusMessageAtom } from "../../shell/state/status";
import { usePushNotifications } from "../hooks/usePushNotifications";

export function PushNotificationsSection() {
  const setStatus = useSetAtom(statusMessageAtom);
  const {
    activeCount,
    disableCurrentDevice,
    enableCurrentDevice,
    isConfigured,
    isCurrentDeviceEnabled,
    isLoading,
    isStandalone,
    isSupported,
  } = usePushNotifications(setStatus);

  return (
    <section className="border-t border-stone-200 pt-3">
      <h3 className="text-sm font-semibold text-stone-900">通知</h3>
      <p className="mt-2 text-xs leading-5 text-stone-600">
        Safari でホーム画面に追加した iPhone PWA のみ対応しています。
        購読済みの端末には、team 全体の未完了タスクをまとめて送ります。
      </p>
      <p className="mt-2 text-xs text-stone-500">
        {activeCount > 0
          ? `現在 ${activeCount} 台の端末が購読中です。`
          : "まだ購読中の端末はありません。"}
      </p>

      {!isSupported ? (
        <p className="mt-2 text-xs text-amber-700">
          このブラウザでは Push 通知を利用できません。
        </p>
      ) : null}
      {isSupported && !isStandalone ? (
        <p className="mt-2 text-xs text-amber-700">
          iPhone の Safari
          で共有メニューから「ホーム画面に追加」したあとに有効化してください。
        </p>
      ) : null}
      {isSupported && isStandalone && !isConfigured ? (
        <p className="mt-2 text-xs text-amber-700">
          通知設定がまだ反映されていません。しばらく待ってから再度お試しください。
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="flex min-h-11 items-center justify-center rounded-lg bg-[color:var(--color-matcha-600)] px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-[color:var(--color-matcha-700)] disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => {
            void enableCurrentDevice();
          }}
          disabled={
            isLoading ||
            !isSupported ||
            !isStandalone ||
            !isConfigured ||
            isCurrentDeviceEnabled
          }
        >
          {isLoading && !isCurrentDeviceEnabled
            ? "有効化中..."
            : "通知をオンにする"}
        </button>
        <button
          type="button"
          className="flex min-h-11 items-center justify-center rounded-lg border border-stone-400 px-4 py-2 text-sm text-stone-800 transition-colors duration-200 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => {
            void disableCurrentDevice();
          }}
          disabled={isLoading || !isCurrentDeviceEnabled}
        >
          {isLoading && isCurrentDeviceEnabled
            ? "解除中..."
            : "この端末の通知をオフにする"}
        </button>
      </div>

      <p className="mt-2 text-xs text-stone-500">
        {isCurrentDeviceEnabled
          ? "この端末は通知対象です。"
          : "この端末はまだ通知対象ではありません。"}
      </p>
    </section>
  );
}
