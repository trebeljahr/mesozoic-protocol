// Must be first: installs the headless rAF shim before @react-three/fiber
// (imported transitively by App) captures or first calls requestAnimationFrame.
import "./headlessRaf";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./i18n";
import "./index.css";

if (import.meta.env.PROD) {
  document.documentElement.dataset.lockSelect = "true";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
