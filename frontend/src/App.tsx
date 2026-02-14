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
    <main className="container">
      <h1>家事チャレ</h1>
      <p>モノレポひな形（React + Vite + Cloudflare Workers）</p>
      <p data-testid="health-status">API Health: {healthState}</p>
    </main>
  );
}

export default App;
