import { useEffect, useState } from "react";
import { RouterProvider } from "react-router-dom";

import { AppProviders } from "./app/providers";
import {
  applyPWAUpdateNow,
  dismissPWAUpdate,
  subscribePWAState,
} from "./app/pwa";
import { router } from "./app/router";
import { StatusToast } from "./features/shell/components/StatusToast";

function App() {
  const [needRefresh, setNeedRefresh] = useState(false);

  useEffect(() => {
    return subscribePWAState((state) => {
      setNeedRefresh(state.needRefresh);
    });
  }, []);

  return (
    <AppProviders>
      <RouterProvider router={router} />
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
    </AppProviders>
  );
}

export default App;
