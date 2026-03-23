import { useEffect, useState } from "react";
import { RouterProvider } from "react-router-dom";

import { useBootFlow } from "./app/boot";
import { AppProviders } from "./app/providers";
import {
  applyPWAUpdateNow,
  dismissPWAUpdate,
  subscribePWAState,
} from "./app/pwa";
import { router } from "./app/router";
import { StatusToast } from "./features/shell/components/StatusToast";
import { BootScreen } from "./shared/components/BootScreen";

function AppShell() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const { isInitialBootPending, markReactMounted } = useBootFlow();

  useEffect(() => {
    markReactMounted();
  }, [markReactMounted]);

  useEffect(() => {
    return subscribePWAState((state) => {
      setNeedRefresh(state.needRefresh);
    });
  }, []);

  return (
    <>
      <RouterProvider router={router} />
      {isInitialBootPending ? <BootScreen mode="overlay" /> : null}
      {needRefresh ? (
        <StatusToast
          message="新しいバージョンを利用できます。更新して最新状態にしますか？"
          onDismiss={dismissPWAUpdate}
          actionLabel="更新する"
          onAction={() => {
            void applyPWAUpdateNow();
          }}
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
