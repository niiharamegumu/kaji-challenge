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
    sendLocalTestNotification,
  } = usePushNotifications(setStatus);

  const switchDisabled =
    isLoading || !isSupported || !isStandalone || !isConfigured;
  const helperMessage = !isSupported
    ? "このブラウザではプッシュ通知を利用できません。"
    : !isStandalone
      ? "iPhone の Safari で「ホーム画面に追加」したあとにオンにしてください。"
      : !isConfigured
        ? "プッシュ通知設定の反映待ちです。少し待ってから再度お試しください。"
        : isCurrentDeviceEnabled
          ? "この端末ではプッシュ通知がオンです。"
          : "この端末ではプッシュ通知がオフです。";

  return (
    <section className="pt-1">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-stone-900">プッシュ通知</h3>
        </div>

        <div className="shrink-0">
          <button
            type="button"
            role="switch"
            aria-checked={isCurrentDeviceEnabled}
            aria-label="この端末のプッシュ通知"
            className={`inline-flex h-8 w-14 items-center rounded-full border transition-colors duration-200 ${
              isCurrentDeviceEnabled
                ? "border-[color:var(--color-matcha-600)] bg-[color:var(--color-matcha-600)]"
                : "border-stone-300 bg-stone-200"
            } disabled:cursor-not-allowed disabled:opacity-60`}
            onClick={() => {
              if (isCurrentDeviceEnabled) {
                void disableCurrentDevice();
                return;
              }
              void enableCurrentDevice();
            }}
            disabled={switchDisabled}
          >
            <span
              className={`mx-1 block h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                isCurrentDeviceEnabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      <div className="mt-2">
        <div className="min-w-0">
          <p className="mt-1 text-xs leading-5 text-stone-600">
            iPhone のホーム画面に追加した PWA で、team
            の未完了タスクをまとめて受け取れます。
          </p>
          <p className="mt-2 text-xs text-stone-500">
            {activeCount > 0
              ? `購読中 ${activeCount} 台`
              : "購読中の端末はまだありません"}
          </p>
        </div>
      </div>

      <p
        className={`mt-3 text-xs ${
          !isSupported || !isStandalone || !isConfigured
            ? "text-amber-700"
            : "text-stone-500"
        }`}
      >
        {helperMessage}
      </p>

      <div className="mt-3">
        <button
          type="button"
          className="flex min-h-10 items-center justify-center rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-700 transition-colors duration-200 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => {
            void sendLocalTestNotification();
          }}
          disabled={isLoading || !isSupported || !isStandalone}
        >
          プッシュ通知をテスト
        </button>
      </div>
    </section>
  );
}
