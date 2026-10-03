import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  off: vi.fn(),
  flush: vi.fn(),
  persistActiveSave: vi.fn(),
  getState: vi.fn(),
  setBlocked: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("./desktopSaves", () => ({ flushDesktopSaves: mocks.flush }));
vi.mock("./persistence/persistActiveSave", () => ({ persistActiveSave: mocks.persistActiveSave }));
vi.mock("./store", () => ({ useGame: { getState: mocks.getState } }));

import { checkForUpdate, installUpdate } from "./updater";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("isTauri", true);
  mocks.listen.mockResolvedValue(mocks.off);
  mocks.invoke.mockResolvedValue(undefined);
  mocks.flush.mockResolvedValue(true);
  mocks.persistActiveSave.mockReturnValue(true);
  mocks.getState.mockReturnValue({
    activeSlot: 1,
    progress: { marker: "before-download" },
    setInterruptionBlocked: mocks.setBlocked,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("desktop update save boundary", () => {
  it("saves post-download progress and awaits durable flush before installation", async () => {
    const download = deferred();
    const downloadStarted = deferred();
    const flush = deferred();
    const flushStarted = deferred();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "updater_download") {
        downloadStarted.resolve();
        await download.promise;
      }
    });
    mocks.flush.mockImplementation(async () => {
      flushStarted.resolve();
      await flush.promise;
      return true;
    });
    const snapshots: unknown[] = [];
    mocks.persistActiveSave.mockImplementation(() => {
      snapshots.push(mocks.getState().progress);
      return true;
    });
    const installing = vi.fn();
    const progress = vi.fn();
    const result = installUpdate(progress, installing);
    await downloadStarted.promise;
    expect(mocks.persistActiveSave).not.toHaveBeenCalled();
    expect(mocks.setBlocked).not.toHaveBeenCalled();
    mocks.getState.mockReturnValue({
      activeSlot: 1,
      progress: { marker: "after-download" },
      setInterruptionBlocked: mocks.setBlocked,
    });
    download.resolve();
    await flushStarted.promise;
    expect(mocks.setBlocked).toHaveBeenCalledWith("update-install", true);
    expect(snapshots).toEqual([{ marker: "after-download" }]);
    expect(installing).toHaveBeenCalledOnce();
    expect(mocks.invoke).not.toHaveBeenCalledWith("updater_install");
    flush.resolve();
    expect(await result).toBe(true);
    expect(mocks.invoke).toHaveBeenLastCalledWith("updater_install");
    expect(mocks.setBlocked).not.toHaveBeenCalledWith("update-install", false);
    expect(mocks.off).toHaveBeenCalledOnce();
  });

  it("blocks installation on a failed native save and permits a retry without a new update check", async () => {
    mocks.flush.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await installUpdate()).toBe(false);
    expect(mocks.invoke).not.toHaveBeenCalledWith("updater_install");
    expect(mocks.setBlocked).toHaveBeenLastCalledWith("update-install", false);
    expect(await installUpdate()).toBe(true);
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      "updater_download",
      "updater_download",
      "updater_install",
    ]);
    expect(mocks.invoke).not.toHaveBeenCalledWith("updater_check");
  });

  it("treats a failed slot snapshot as a save failure even when native disk could flush", async () => {
    mocks.persistActiveSave.mockReturnValue(false);
    expect(await installUpdate()).toBe(false);
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith("updater_install");
    expect(mocks.setBlocked).toHaveBeenLastCalledWith("update-install", false);
  });

  it("aborts before installation when the final confirmation interface disappeared", async () => {
    expect(
      await installUpdate(undefined, () => {
        throw new Error("unmounted");
      }),
    ).toBe(false);
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith("updater_install");
    expect(mocks.setBlocked).toHaveBeenLastCalledWith("update-install", false);
  });

  it("leaves gameplay alone on download failure and clears the blocker on install failure", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("download failed"));
    expect(await installUpdate()).toBe(false);
    expect(mocks.setBlocked).not.toHaveBeenCalled();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "updater_install") throw new Error("installer failed");
    });
    expect(await installUpdate()).toBe(false);
    expect(mocks.setBlocked).toHaveBeenLastCalledWith("update-install", false);
  });

  it("coalesces concurrent install requests and cleans up progress listeners", async () => {
    const download = deferred();
    const started = deferred();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "updater_download") {
        started.resolve();
        await download.promise;
      }
    });
    const progress = vi.fn();
    const first = installUpdate(progress);
    const second = installUpdate();
    expect(second).toBe(first);
    await started.promise;
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    const listener = mocks.listen.mock.calls[0][1];
    listener({ payload: { downloaded: 30, total: 100 } });
    expect(progress).toHaveBeenCalledWith({ downloaded: 30, total: 100 });
    download.resolve();
    expect(await first).toBe(true);
    expect(mocks.off).toHaveBeenCalledOnce();
  });

  it("handles the web shell and unavailable updater without touching saves", async () => {
    vi.stubGlobal("isTauri", false);
    expect(await installUpdate()).toBe(false);
    expect(await checkForUpdate()).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.flush).not.toHaveBeenCalled();
    vi.stubGlobal("isTauri", true);
    mocks.invoke.mockRejectedValue(new Error("command not found"));
    expect(await checkForUpdate()).toBeNull();
  });
});
