import { Capacitor } from "@capacitor/core";

// Steam and standalone desktop releases use Tauri. Mobile apps use Capacitor.
export const isInstalledApp = (): boolean => {
  try {
    return !!(globalThis as { isTauri?: boolean }).isTauri || Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};
