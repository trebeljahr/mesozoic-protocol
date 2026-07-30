//! Tauri v2 auto-updater wiring.
//!
//! Compiled only when the `updater` Cargo feature is on (see Cargo.toml for
//! why that feature is opt-in) and only on desktop targets.
//!
//! ## Why the update flow is driven from Rust instead of the JS plugin API
//!
//! `tauri-plugin-updater`'s `download_and_install` IPC command builds its
//! updater through `UpdaterExt::updater_builder()`, which hardcodes
//! `on_before_exit(|| app.cleanup_before_exit())`. There is no way to add our
//! own hook to that path. On Windows the installer force-exits the process
//! (`std::process::exit(0)`) the moment it starts, so without our own hook the
//! frontend never learns the app is about to die and never gets to persist.
//!
//! So the plugin is still registered — it holds the `pubkey`/`endpoints`
//! config that `updater_builder()` reads — but the two commands the frontend
//! calls are ours. As a side effect they need no capability entries: Tauri v2
//! only ACL-checks `plugin:`-prefixed commands (and app commands when the app
//! ships its own `permissions/` manifest, which this one does not).

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Emitted just before a Windows installer force-exits the process. The
/// frontend's listener should do synchronous persistence only.
pub const BEFORE_EXIT_EVENT: &str = "updater://before-exit";
/// Emitted while the update payload downloads.
pub const PROGRESS_EVENT: &str = "updater://download-progress";

/// How long we block the installer thread after emitting `BEFORE_EXIT_EVENT`.
///
/// This is a best-effort window, not a guarantee: `Emitter::emit` hands the
/// payload to the webview asynchronously, and the WebView's localStorage is
/// itself flushed to disk on its own schedule. Long enough to matter, short
/// enough that a wedged renderer does not visibly stall the install.
const BEFORE_EXIT_GRACE: Duration = Duration::from_millis(600);

/// The `Update` handle produced by a check, parked until the user accepts.
#[derive(Default)]
struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    version: String,
    current_version: String,
    notes: Option<String>,
    date: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    downloaded: u64,
    total: Option<u64>,
}

/// True when this process looks like it was launched from a Steam install.
///
/// Second layer behind the `updater` Cargo feature. It is load-bearing rather
/// than decorative here: `steam.yml` does not build anything, it reuses the
/// `*-portable` artifacts produced by the same `tauri build` runs that produce
/// the installers, so the depot binary and the installer binary are the same
/// binary. The compile-time feature cannot tell them apart; this can.
fn is_steam_runtime() -> bool {
    // Set by the Steam client for every process it launches.
    for key in [
        "SteamAppId",
        "SteamGameId",
        "SteamOverlayGameId",
        "SteamClientLaunch",
    ] {
        if std::env::var_os(key).is_some_and(|v| !v.is_empty()) {
            return true;
        }
    }

    let Ok(exe) = std::env::current_exe() else {
        return false;
    };

    // Dropped next to the executable so the Steamworks SDK can attach when the
    // game is started outside the client during development.
    if exe
        .parent()
        .is_some_and(|dir| dir.join("steam_appid.txt").exists())
    {
        return true;
    }

    // .../Steam/steamapps/common/<Game>/... on all three desktop platforms.
    exe.components()
        .any(|c| c.as_os_str().eq_ignore_ascii_case("steamapps"))
}

/// Asks the configured endpoint whether a newer version exists.
///
/// Returns `Ok(None)` when the app is already current. The resulting `Update`
/// is parked in app state so `updater_install` can act on the exact release
/// the user was shown.
#[tauri::command]
async fn updater_check<R: Runtime>(
    app: AppHandle<R>,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    let handle = app.clone();
    let updater = app
        .updater_builder()
        // Overrides the plugin's default hook, which is exactly
        // `cleanup_before_exit()` — so we have to call that ourselves.
        .on_before_exit(move || {
            let _ = handle.emit(BEFORE_EXIT_EVENT, ());
            std::thread::sleep(BEFORE_EXIT_GRACE);
            handle.cleanup_before_exit();
        })
        .build()
        .map_err(|e| e.to_string())?;

    let update = updater.check().await.map_err(|e| e.to_string())?;

    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    });

    *pending.0.lock().map_err(|e| e.to_string())? = update;
    Ok(info)
}

/// Downloads and installs the update parked by the last `updater_check`.
#[tauri::command]
async fn updater_install<R: Runtime>(
    app: AppHandle<R>,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = {
        let mut slot = pending.0.lock().map_err(|e| e.to_string())?;
        slot.take()
    }
    .ok_or_else(|| "no pending update — run updater_check first".to_string())?;

    let progress_app = app.clone();
    let mut downloaded: u64 = 0;
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress_app.emit(PROGRESS_EVENT, DownloadProgress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;

    // Windows never gets here: the installer force-exits the process through
    // the `on_before_exit` hook above. macOS and Linux swap the bundle in
    // place and return, so the relaunch is ours to do.
    app.restart();
}

/// Registers the plugin and the two commands, unless this looks like a Steam
/// install — in which case nothing is registered and every `invoke` from the
/// frontend fails with "command not found", which the frontend treats as
/// "updates are not available here".
pub fn register<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    if is_steam_runtime() {
        eprintln!("mesozoic-protocol: Steam runtime detected — in-app updater disabled");
        return builder;
    }

    builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingUpdate::default())
        .invoke_handler(tauri::generate_handler![updater_check, updater_install])
}
