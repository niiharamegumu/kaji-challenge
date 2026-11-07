import { useSetAtom } from "jotai";

import { InfoHelp } from "../../../shared/components/InfoHelp";
import { statusMessageAtom } from "../../../shared/state/status";
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

  const switchDisabled = isLoading || !isSupported || !isStandalone || !isConfigured;
  const unavailableReason = !isSupported
    ? "このブラウザーはプッシュ通知に対応していません。"
    : !isStandalone
      ? "ホーム画面からの起動が必要です。"
      : !isConfigured
        ? "プッシュ通知設定の反映待ちです。"
        : null;

  return (
    <section className="pt-1">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-1">
          <h3 className="text-sm font-semibold text-heading">プッシュ通知</h3>
          <InfoHelp label="プッシュ通知の使い方">
            <p>この端末でチームの未完了タスクをまとめて受け取れます。</p>
            <p>
              iPhoneではSafariで「ホーム画面に追加」し、そこからアプリを開いて通知をオンにしてください。
            </p>
            {isSupported && isStandalone && !isConfigured && (
              <p>設定の反映を少し待って、もう一度お試しください。</p>
            )}
          </InfoHelp>
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
                : "border-line-strong bg-surface-active"
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
              className={`mx-1 block h-6 w-6 rounded-full bg-surface shadow-sm transition-transform duration-200 ${
                isCurrentDeviceEnabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      <p className="mt-2 text-xs text-muted">
        {activeCount > 0 ? `購読中 ${activeCount} 台` : "購読中の端末はまだありません"}
      </p>
      {unavailableReason && <p className="mt-2 text-xs text-warning">{unavailableReason}</p>}

      <div className="mt-3">
        <button
          type="button"
          className="flex min-h-10 items-center justify-center rounded-lg border border-line-strong px-4 py-2 text-sm text-body transition-colors duration-200 hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-60"
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
