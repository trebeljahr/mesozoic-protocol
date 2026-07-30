// Must be first: installs the headless rAF shim before @react-three/fiber
// (imported transitively by App) captures or first calls requestAnimationFrame.
import "./headlessRaf";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { installNativeSaveMirror, restoreNativeSaveBackup } from "./nativeSaveBackup";

if (import.meta.env.PROD) {
  document.documentElement.dataset.lockSelect = "true";
}

// App and i18n both read localStorage while their modules evaluate, so on the
// Capacitor shells the durable save mirror has to be restored before either is
// imported — hence the dynamic imports. Off-native both calls resolve
// immediately and this costs one extra microtask.
const boot = async (): Promise<void> => {
  await restoreNativeSaveBackup();
  installNativeSaveMirror();

  const [{ App }] = await Promise.all([import("./App"), import("./i18n")]);

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
};

void boot();
