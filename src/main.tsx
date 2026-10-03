// Must be first: installs the headless rAF shim before @react-three/fiber
// (imported transitively by App) captures or first calls requestAnimationFrame.
import "./headlessRaf";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { initializeDesktopSaves, setDesktopBeforeClose } from "./desktopSaves";
import { installNativeSaveMirror, restoreNativeSaveBackup } from "./nativeSaveBackup";

if (import.meta.env.PROD) {
  document.documentElement.dataset.lockSelect = "true";
}

// App reads campaign data while its modules evaluate, so durable saves must
// be restored first. The error screen only loads i18n, which reads device language.
const root = createRoot(document.getElementById("root")!);
const runBoot = async (): Promise<void> => {
  try {
    await initializeDesktopSaves();
  } catch {
    // Do not import the game with stale browser saves if the authoritative
    // desktop document is unreadable or another instance holds its lock.
    const [{ DesktopSaveStartupError }] = await Promise.all([
      import("./ui/DesktopSaveStartupError"),
      import("./i18n"),
    ]);
    root.render(<DesktopSaveStartupError onRetry={boot} />);
    return;
  }
  await restoreNativeSaveBackup();
  installNativeSaveMirror();

  const [{ App }] = await Promise.all([import("./App"), import("./i18n")]);
  const [{ persistActiveSave }, { useGame }] = await Promise.all([
    import("./persistence/persistActiveSave"),
    import("./store"),
  ]);
  setDesktopBeforeClose(
    () => {
      useGame.getState().setInterruptionBlocked("native-background", true);
      return persistActiveSave();
    },
    () => useGame.getState().setInterruptionBlocked("native-background", false),
  );

  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
};

// A retry shares any active boot instead of starting a second restore or
// mounting the game twice. Keep this guard outside React render timing.
let bootPromise: Promise<void> | null = null;
const boot = (): Promise<void> => {
  if (bootPromise) return bootPromise;
  bootPromise = runBoot().finally(() => {
    bootPromise = null;
  });
  return bootPromise;
};

void boot();
