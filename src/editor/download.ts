// Dev-only "save to disk" helper for the editor JSON exports. Builds a
// Blob, drops an anchor with `download` set, clicks it, then revokes the
// object URL on the next microtask so the browser still has it pinned
// long enough to initiate the download. No top-level side effects — the
// whole editor surface tree-shakes out of production builds.

export const downloadJson = (filename: string, json: string): void => {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the download actually starts. Revoking synchronously
  // can cancel the in-flight fetch in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
