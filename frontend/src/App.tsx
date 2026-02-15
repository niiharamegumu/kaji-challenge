import { useEffect, useState } from "react";

import { health as fetchHealth } from "./lib/api/generated/client";

type HealthState = "loading" | "ok" | "error";

function App() {
  const [healthState, setHealthState] = useState<HealthState>("loading");

  useEffect(() => {
    const run = async () => {
      try {
        await fetchHealth();
        setHealthState("ok");
      } catch {
        setHealthState("error");
      }
    };

    void run();
  }, []);

  return (
    <main className="min-h-screen bg-linear-to-br from-sky-50 to-cyan-50 text-gray-800">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-3xl font-semibold">家事チャレ</h1>
        <p className="mt-3">
          モノレポひな形（React + Vite + Cloudflare Workers）
        </p>
        <p className="mt-2" data-testid="health-status">
          API Health: {healthState}
        </p>
      </div>
    </main>
  );
}

export default App;
