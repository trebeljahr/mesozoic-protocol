import type { World } from "./sim/types";

export type InterruptionReason = "hidden" | "page-hidden" | "native-background" | "orientation";

// Blockers belong to the app; the resume latch belongs to a mission. A new
// mission inherits current blockers, but never an old mission's resume latch.
export class SessionPause {
  private blockers = new Set<InterruptionReason>();
  private interrupted = new WeakSet<World>();

  setBlocked(reason: InterruptionReason, blocked: boolean, world: World) {
    if (blocked) this.blockers.add(reason);
    else this.blockers.delete(reason);
    this.enforce(world);
  }

  enforce(world: World) {
    if (world.status !== "running" && world.status !== "paused") return;
    if (this.blockers.size > 0) this.interrupted.add(world);
    if (this.interrupted.has(world)) world.status = "paused";
  }

  canAutoResume(world: World) {
    return this.blockers.size === 0 && !this.interrupted.has(world);
  }

  resume(world: World) {
    if (this.blockers.size > 0) return false;
    this.interrupted.delete(world);
    world.status = "running";
    return true;
  }
}

export const sessionPause = new SessionPause();

// Web visibility covers Capacitor's Android task switching and iOS WKWebView.
// pagehide/pageshow also cover page-cache transitions. Native pause/resume
// events are supported when supplied by the host; independent reasons mean
// one foreground signal cannot clear another still-active blocker.
export function listenForSessionInterruptions(
  doc: Document,
  win: Window,
  setBlocked: (reason: InterruptionReason, blocked: boolean) => void,
) {
  const visibility = () => setBlocked("hidden", doc.visibilityState === "hidden");
  const hide = () => setBlocked("page-hidden", true);
  const show = () => {
    setBlocked("page-hidden", false);
    visibility();
  };
  const pause = () => setBlocked("native-background", true);
  const resume = () => {
    setBlocked("native-background", false);
    visibility();
  };
  doc.addEventListener("visibilitychange", visibility);
  doc.addEventListener("pause", pause);
  doc.addEventListener("resume", resume);
  win.addEventListener("pagehide", hide);
  win.addEventListener("pageshow", show);
  visibility();
  return () => {
    doc.removeEventListener("visibilitychange", visibility);
    doc.removeEventListener("pause", pause);
    doc.removeEventListener("resume", resume);
    win.removeEventListener("pagehide", hide);
    win.removeEventListener("pageshow", show);
  };
}
