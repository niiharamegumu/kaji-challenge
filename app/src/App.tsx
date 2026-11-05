import { useEffect, useState } from "react";
import { Outlet } from "@tanstack/react-router";
import { initializePWA } from "./app/pwa-register";

import { useBootFlow } from "./app/boot";
import { AppProviders } from "./app/providers";
import { applyPWAUpdateNow, dismissPWAUpdate, subscribePWAState } from "./app/pwa";
import { StatusToast } from "./features/shell/components/StatusToast";
import { BootScreen } from "./shared/components/BootScreen";

function AppShell() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateFailed, setUpdateFailed] = useState(false);
  const { isInitialBootPending, markReactMounted } = useBootFlow();

  useEffect(() => {
    initializePWA();
    markReactMounted();
  }, [markReactMounted]);

  useEffect(() => {
    return subscribePWAState((state) => {
      setNeedRefresh(state.needRefresh);
    });
  }, []);

  return (
    <>
      <Outlet />
      {isInitialBootPending ? <BootScreen mode="overlay" /> : null}
      {needRefresh ? (
        <StatusToast
          message="新しいバージョンを利用できます。更新して最新状態にしますか？"
          onDismiss={dismissPWAUpdate}
          actionLabel="更新する"
          autoDismiss={false}
          onAction={() => {
            setUpdateFailed(false);
            void applyPWAUpdateNow().catch(() => setUpdateFailed(true));
          }}
        />
      ) : updateFailed ? (
        <StatusToast
          message="更新を適用できませんでした。設定からもう一度確認してください。"
          onDismiss={() => setUpdateFailed(false)}
        />
      ) : null}
    </>
  );
}

function App() {
  return (
    <AppProviders>
      <AppShell />
    </AppProviders>
  );
}

export default App;
