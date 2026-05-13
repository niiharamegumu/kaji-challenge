import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { initializePWA } from "./app/pwa-register";
import { setApiBaseUrl } from "./lib/api/client";
import "./tailwind.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("root element not found");
}

initializePWA();
setApiBaseUrl(import.meta.env.VITE_API_BASE_URL ?? "/api");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
