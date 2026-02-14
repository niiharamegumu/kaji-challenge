import { useEffect, useState } from "react";

import { health } from "./lib/api/generated/client";

type HealthState = "loading" | "ok" | "error";

function App() {
  const [health, setHealth] = useState<HealthState>("loading");

  useEffect(() => {
    const run = async () => {
      try {
        await health();
        setHealth("ok");
      } catch {
        setHealth("error");
      }
    };

    void run();
  }, [health]);

  return (
    <main className="container">
      <h1>家事チャレ</h1>
      <p>モノレポひな形（React + Vite + Cloudflare Workers）</p>
      <p data-testid="health-status">API Health: {health}</p>
    </main>
  );
}

export default App;
