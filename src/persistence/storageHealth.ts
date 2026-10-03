import { useSyncExternalStore } from "react";

export type SaveIssue = { key: string; reason: "write" | "read" | "corrupt" | "native" };
let issues: SaveIssue[] = [];
const listeners = new Set<() => void>();
const retries = new Map<string, () => boolean | Promise<boolean>>();

export const reportSaveIssue = (issue: SaveIssue, retry?: () => boolean | Promise<boolean>) => {
  if (retry) retries.set(issue.key, retry);
  if (issues.some((i) => i.key === issue.key && i.reason === issue.reason)) return;
  issues = [...issues.filter((i) => i.key !== issue.key), issue];
  for (const fn of listeners) fn();
};
export const clearSaveIssue = (key: string) => {
  retries.delete(key);
  if (!issues.some((i) => i.key === key)) return;
  issues = issues.filter((i) => i.key !== key);
  for (const fn of listeners) fn();
};
export const getSaveIssues = () => issues;
export const subscribeSaveHealth = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const retryFailedSaves = async () => {
  for (const retry of [...retries.values()]) await retry();
};
export const useSaveIssues = () =>
  useSyncExternalStore(subscribeSaveHealth, getSaveIssues, getSaveIssues);

// Browser origins are storage boundaries. This only copies an old name on
// this origin; it cannot transfer saves from another website.
export const migrateStorageKey = (storage: Storage, oldKey: string, newKey: string): boolean => {
  try {
    const old = storage.getItem(oldKey);
    if (old === null || storage.getItem(newKey) !== null) return true;
    storage.setItem(newKey, old);
    if (storage.getItem(newKey) !== old) throw new Error("Storage verification failed");
    storage.removeItem(oldKey);
    clearSaveIssue(newKey);
    return true;
  } catch {
    reportSaveIssue({ key: newKey, reason: "write" }, () =>
      migrateStorageKey(storage, oldKey, newKey),
    );
    return false;
  }
};
