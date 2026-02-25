import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { initializePWA } from "./app/pwa-register";
import "./tailwind.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("root element not found");
}

initializePWA();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
