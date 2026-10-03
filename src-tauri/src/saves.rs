//! Desktop save storage. Only the fixed save document is exposed through IPC.
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Window, WindowEvent};

const PRIMARY: &str = "progress.json";
const BACKUP: &str = "progress.backup.json";
const MAX_BYTES: u64 = 10 * 1024 * 1024;
const CLOSE_EVENT: &str = "desktop-save-close-requested";
type Entries = BTreeMap<String, String>;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Document {
    format_version: u32,
    entries: Entries,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadResult {
    entries: Option<Entries>,
    directory: String,
    recovered: bool,
    allow_legacy_import: bool,
}

struct Snapshot {
    entries: Option<Entries>,
    recovered: bool,
}

enum ReadResult {
    Missing,
    Valid(Entries),
    Invalid(String),
    Unsupported,
}

/// The file handle retains an OS lock for this process, including between saves.
/// Steam Auto-Cloud includes only *.json, never this lock or temporary files.
struct SaveStore {
    directory: PathBuf,
    _lock: File,
    known: Option<Option<Entries>>,
}

#[derive(Default)]
pub(crate) struct SaveState {
    store: Arc<Mutex<Option<SaveStore>>>,
    loaded: AtomicBool,
    closing: AtomicBool,
}

fn allowed_key(key: &str) -> bool {
    let Some(rest) = key
        .strip_prefix("mesozoic-protocol:")
        .or_else(|| key.strip_prefix("extinction-protocol:"))
    else {
        return false;
    };
    matches!(rest, "progress:v1" | "training-offer-seen")
        || ["1", "2", "3"].iter().any(|slot| {
            rest == format!("slot:{slot}:v1") || rest == format!("slot:{slot}:v1:backup")
        })
}

fn validate_entries(entries: &Entries) -> Result<(), String> {
    for key in entries.keys() {
        if !allowed_key(key) {
            return Err(format!("Unsupported save key: {key}"));
        }
    }
    Ok(())
}

fn encode(entries: &Entries) -> Result<Vec<u8>, String> {
    // Check before encoding as well as after escaping strings into the envelope.
    if entries
        .iter()
        .map(|(key, value)| key.len() + value.len())
        .sum::<usize>()
        > MAX_BYTES as usize
    {
        return Err("Save data exceeds the 10 MiB limit".into());
    }
    validate_entries(entries)?;
    let bytes = serde_json::to_vec(&Document {
        format_version: 1,
        entries: entries.clone(),
    })
    .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("Save document exceeds the 10 MiB limit".into());
    }
    Ok(bytes)
}

fn read_document(path: &Path) -> ReadResult {
    let result = (|| -> Result<ReadResult, String> {
        let metadata = match fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(ReadResult::Missing)
            }
            Err(error) => return Err(error.to_string()),
        };
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("Save path is not a regular file".into());
        }
        if metadata.len() > MAX_BYTES {
            return Err("Save document exceeds the 10 MiB limit".into());
        }
        let mut bytes = Vec::new();
        File::open(path)
            .map_err(|error| error.to_string())?
            .take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("Save document exceeds the 10 MiB limit".into());
        }
        let value: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
        let version = value
            .get("formatVersion")
            .and_then(serde_json::Value::as_u64)
            .ok_or("Save document has no valid formatVersion")?;
        // Future envelopes can change fields and entries. Never mistake those
        // for damage and replace a newer save with an older backup.
        if version != 1 {
            return Ok(ReadResult::Unsupported);
        }
        let document: Document =
            serde_json::from_value(value).map_err(|error| error.to_string())?;
        validate_entries(&document.entries)?;
        Ok(ReadResult::Valid(document.entries))
    })();
    result.unwrap_or_else(ReadResult::Invalid)
}

fn read_snapshot(directory: &Path) -> Result<Snapshot, String> {
    let primary = read_document(&directory.join(PRIMARY));
    match primary {
        ReadResult::Valid(entries) => {
            return Ok(Snapshot {
                entries: Some(entries),
                recovered: false,
            })
        }
        ReadResult::Unsupported => {
            return Err("Save format is newer than this game; files were not changed".into())
        }
        _ => {}
    }
    match read_document(&directory.join(BACKUP)) {
        ReadResult::Valid(entries) => Ok(Snapshot {
            entries: Some(entries),
            recovered: true,
        }),
        ReadResult::Missing if matches!(primary, ReadResult::Missing) => Ok(Snapshot {
            entries: None,
            recovered: false,
        }),
        ReadResult::Unsupported => {
            Err("Backup save format is newer than this game; files were not changed".into())
        }
        backup => {
            let reason = |result: ReadResult| match result {
                ReadResult::Invalid(reason) => reason,
                _ => "file is missing".into(),
            };
            Err(format!("Cannot read save or backup (save: {}; backup: {}). Files were not changed. Restore a valid copy, then retry.", reason(primary), reason(backup)))
        }
    }
}

#[cfg(unix)]
fn sync_directory(directory: &Path) -> std::io::Result<()> {
    File::open(directory)?.sync_all()
}

#[cfg(windows)]
fn sync_directory(_directory: &Path) -> std::io::Result<()> {
    // MoveFileExW below uses WRITE_THROUGH; Windows does not support fsync on directories.
    Ok(())
}

#[cfg(unix)]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // Both zero-terminated paths stay alive through this call; no pointers are retained.
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn atomic_write(directory: &Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    let mut temporary = tempfile::Builder::new()
        .prefix(".save-")
        .tempfile_in(directory)
        .map_err(|error| error.to_string())?;
    temporary
        .write_all(bytes)
        .map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    let (file, path) = temporary.into_parts();
    drop(file);
    replace_file(&path, &directory.join(name)).map_err(|error| error.to_string())?;
    sync_directory(directory).map_err(|error| error.to_string())
}

fn prepare_directory(directory: &Path) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    if fs::symlink_metadata(directory)
        .map_err(|error| error.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("Save directory must not be a symbolic link".into());
    }
    if let Some(parent) = directory.parent() {
        sync_directory(parent).map_err(|error| error.to_string())?;
    }
    Ok(())
}

impl SaveStore {
    fn open(directory: PathBuf) -> Result<Self, String> {
        prepare_directory(&directory)?;
        let lock_path = directory.join(".write-lock");
        if fs::symlink_metadata(&lock_path)
            .is_ok_and(|metadata| !metadata.is_file() || metadata.file_type().is_symlink())
        {
            return Err("Save lock is not a regular file".into());
        }
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_path)
            .map_err(|error| error.to_string())?;
        lock.try_lock().map_err(|error| format!("Save files are already open in another game instance, or cannot be locked: {error}"))?;
        Ok(Self {
            directory,
            _lock: lock,
            known: None,
        })
    }

    fn load(&mut self) -> Result<LoadResult, String> {
        self.known = None;
        let snapshot = read_snapshot(&self.directory)?;
        self.known = Some(snapshot.entries.clone());
        Ok(LoadResult {
            entries: snapshot.entries,
            directory: self.directory.to_string_lossy().into_owned(),
            recovered: snapshot.recovered,
            allow_legacy_import: true,
        })
    }

    fn write(&mut self, entries: Entries) -> Result<(), String> {
        self.write_with(entries, atomic_write)
    }

    fn write_with(
        &mut self,
        entries: Entries,
        mut publish: impl FnMut(&Path, &str, &[u8]) -> Result<(), String>,
    ) -> Result<(), String> {
        let bytes = encode(&entries)?;
        let known = self
            .known
            .as_ref()
            .ok_or("Load or recover save files before writing")?;
        let current = read_snapshot(&self.directory)?;
        if &current.entries != known {
            return Err("Save files changed outside this game. Reload them before saving; files were not changed.".into());
        }
        // Never rotate a corrupt primary into the backup. On the first save,
        // keep a second copy immediately; a failed primary replacement is recoverable.
        let backup = match &current.entries {
            Some(previous) => encode(previous)?,
            None => bytes.clone(),
        };
        let published = (|| {
            publish(&self.directory, BACKUP, &backup)?;
            publish(&self.directory, PRIMARY, &bytes)
        })();
        if let Err(error) = published {
            // A rename can succeed before its directory fsync fails. On the
            // first write, the backup can also be published before primary.
            // Recognize only our exact payload so retry can finish that write
            // without misclassifying it as an external edit.
            if let Ok(after) = read_snapshot(&self.directory) {
                if after.entries.as_ref() == Some(&entries) {
                    self.known = Some(after.entries);
                }
            }
            return Err(error);
        }
        self.known = Some(Some(entries));
        Ok(())
    }
}

fn directory<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map(|path| path.join("saves"))
        .map_err(|error| error.to_string())?;
    Ok(match crate::steam::read_save_identity()? {
        Some(steam_id) => base.join("steam").join(steam_id.to_string()),
        None => base,
    })
}

#[tauri::command]
pub(crate) fn desktop_saves_directory<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    Ok(directory(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
pub(crate) async fn desktop_saves_load<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SaveState>,
) -> Result<LoadResult, String> {
    let path = directory(&app)?;
    let allow_legacy_import = crate::steam::read_save_identity()?.is_none();
    let store = Arc::clone(&state.store);
    state.loaded.store(false, Ordering::SeqCst);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut slot = store.lock().map_err(|error| error.to_string())?;
        if slot.is_none() {
            *slot = Some(SaveStore::open(path)?);
        }
        let mut result = slot.as_mut().ok_or("Save storage is unavailable")?.load()?;
        result.allow_legacy_import = allow_legacy_import;
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?;
    state.loaded.store(result.is_ok(), Ordering::SeqCst);
    result
}

#[tauri::command]
pub(crate) async fn desktop_saves_write(
    entries: Entries,
    state: State<'_, SaveState>,
) -> Result<(), String> {
    let store = Arc::clone(&state.store);
    tauri::async_runtime::spawn_blocking(move || {
        store
            .lock()
            .map_err(|error| error.to_string())?
            .as_mut()
            .ok_or("Load save files before writing")?
            .write(entries)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn desktop_saves_open_directory<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let path = directory(&app)?;
    prepare_directory(&path)?;
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("/usr/bin/open");
        command.arg("--");
        command
    };
    #[cfg(windows)]
    let mut command = Command::new("explorer.exe");
    #[cfg(target_os = "linux")]
    let mut command = Command::new("xdg-open");
    let mut child = command
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| error.to_string())?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[tauri::command]
pub(crate) fn desktop_saves_close<R: Runtime>(
    window: Window<R>,
    state: State<'_, SaveState>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main game window can close the game".into());
    }
    state.closing.store(true, Ordering::SeqCst);
    if let Err(error) = window.destroy() {
        state.closing.store(false, Ordering::SeqCst);
        return Err(error.to_string());
    }
    window.app_handle().exit(0);
    Ok(())
}

pub(crate) fn window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    let state = window.state::<SaveState>();
    if window.label() == "main"
        && state.loaded.load(Ordering::SeqCst)
        && !state.closing.load(Ordering::SeqCst)
    {
        api.prevent_close();
        if let Err(error) = window.emit(CLOSE_EVENT, ()) {
            eprintln!("Cannot request save flush before closing: {error}");
        }
    }
}

pub(crate) fn run_event<R: Runtime>(app: &AppHandle<R>, event: &tauri::RunEvent) {
    let tauri::RunEvent::ExitRequested {
        code: None, api, ..
    } = event
    else {
        return;
    };
    let state = app.state::<SaveState>();
    if state.loaded.load(Ordering::SeqCst) && !state.closing.load(Ordering::SeqCst) {
        if let Some(window) = app.get_webview_window("main") {
            api.prevent_exit();
            if let Err(error) = window.emit(CLOSE_EVENT, ()) {
                eprintln!("Cannot request save flush before exit: {error}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entries(value: &str) -> Entries {
        BTreeMap::from([(
            "mesozoic-protocol:progress:v1".into(),
            format!("{{\"marker\":\"{value}\"}}"),
        )])
    }

    #[test]
    fn first_load_migration_and_previous_generation_backup() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = SaveStore::open(temp.path().join("saves")).unwrap();
        assert!(store.write(entries("before-load")).is_err());
        assert!(store.load().unwrap().entries.is_none());
        store.write(entries("first")).unwrap();
        store.write(entries("second")).unwrap();
        assert_eq!(store.load().unwrap().entries, Some(entries("second")));
        fs::write(store.directory.join(PRIMARY), b"interrupted").unwrap();
        let recovered = store.load().unwrap();
        assert!(recovered.recovered);
        assert_eq!(recovered.entries, Some(entries("first")));
        assert_eq!(
            fs::read(store.directory.join(PRIMARY)).unwrap(),
            b"interrupted"
        );
        store.write(entries("recovered-and-saved")).unwrap();
        assert_eq!(
            store.load().unwrap().entries,
            Some(entries("recovered-and-saved"))
        );
        assert!(
            matches!(read_document(&store.directory.join(BACKUP)), ReadResult::Valid(data) if data == entries("first"))
        );
    }

    #[test]
    fn missing_primary_recovers_backup_and_empty_document_is_authoritative() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = SaveStore::open(temp.path().join("saves")).unwrap();
        store.load().unwrap();
        store.write(Entries::new()).unwrap();
        fs::remove_file(store.directory.join(PRIMARY)).unwrap();
        let loaded = store.load().unwrap();
        assert!(loaded.recovered);
        assert_eq!(loaded.entries, Some(Entries::new()));
    }

    #[test]
    fn two_corrupt_files_block_overwrites_without_changing_either() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = SaveStore::open(temp.path().join("saves")).unwrap();
        fs::write(store.directory.join(PRIMARY), "bad primary").unwrap();
        fs::write(store.directory.join(BACKUP), "bad backup").unwrap();
        assert!(store.load().is_err());
        assert!(store.write(entries("replacement")).is_err());
        assert_eq!(
            fs::read_to_string(store.directory.join(PRIMARY)).unwrap(),
            "bad primary"
        );
        assert_eq!(
            fs::read_to_string(store.directory.join(BACKUP)).unwrap(),
            "bad backup"
        );
    }

    #[test]
    fn keys_and_size_are_validated_before_touching_disk() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = SaveStore::open(temp.path().join("saves")).unwrap();
        store.load().unwrap();
        store.write(entries("original")).unwrap();
        for key in [
            "../../outside",
            "mesozoic-protocol:slot:4:v1",
            "mesozoic-protocol:audio:v2",
            "extinction-protocol:slot:1:v1:backup:extra",
        ] {
            assert!(store
                .write(BTreeMap::from([(key.into(), "{}".into())]))
                .is_err());
        }
        assert!(store
            .write(BTreeMap::from([(
                "mesozoic-protocol:progress:v1".into(),
                format!("\"{}\"", "x".repeat(MAX_BYTES as usize))
            )]))
            .is_err());
        assert_eq!(store.load().unwrap().entries, Some(entries("original")));
        for prefix in ["mesozoic-protocol", "extinction-protocol"] {
            for suffix in [
                "slot:1:v1",
                "slot:2:v1:backup",
                "slot:3:v1",
                "progress:v1",
                "training-offer-seen",
            ] {
                assert!(allowed_key(&format!("{prefix}:{suffix}")));
            }
        }
    }

    #[test]
    fn another_instance_cannot_write_and_lock_is_released_on_drop() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("saves");
        let store = SaveStore::open(path.clone()).unwrap();
        assert!(SaveStore::open(path.clone()).is_err());
        drop(store);
        assert!(SaveStore::open(path).is_ok());
    }

    #[test]
    fn first_write_can_retry_after_only_backup_was_published() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = SaveStore::open(temp.path().join("saves")).unwrap();
        store.load().unwrap();
        let value = entries("first");
        assert!(store
            .write_with(value.clone(), |directory, name, bytes| {
                if name == PRIMARY {
                    return Err("disk full".into());
                }
                atomic_write(directory, name, bytes)
            })
            .is_err());
        assert!(!store.directory.join(PRIMARY).exists());
        store.write(value.clone()).unwrap();
        assert_eq!(store.load().unwrap().entries, Some(value));
    }

    #[test]
    fn write_can_retry_after_primary_rename_succeeds_but_sync_fails() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = SaveStore::open(temp.path().join("saves")).unwrap();
        store.load().unwrap();
        store.write(entries("original")).unwrap();
        let value = entries("new");
        assert!(store
            .write_with(value.clone(), |directory, name, bytes| {
                atomic_write(directory, name, bytes)?;
                if name == PRIMARY {
                    return Err("sync failed".into());
                }
                Ok(())
            })
            .is_err());
        store.write(value.clone()).unwrap();
        assert_eq!(store.load().unwrap().entries, Some(value));
    }

    #[test]
    fn external_changes_and_future_format_do_not_roll_back() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = SaveStore::open(temp.path().join("saves")).unwrap();
        store.load().unwrap();
        store.write(entries("original")).unwrap();
        fs::write(
            store.directory.join(PRIMARY),
            encode(&entries("external")).unwrap(),
        )
        .unwrap();
        assert!(store.write(entries("stale")).is_err());
        assert_eq!(store.load().unwrap().entries, Some(entries("external")));
        let future = r#"{"formatVersion":2,"entries":"a future representation","newField":true}"#;
        fs::write(store.directory.join(PRIMARY), future).unwrap();
        assert!(store.load().unwrap_err().contains("newer"));
        assert!(store.write(entries("old-format")).is_err());
        assert_eq!(
            fs::read_to_string(store.directory.join(PRIMARY)).unwrap(),
            future
        );
    }

    #[test]
    fn migration_preserves_opaque_slot_values_for_frontend_recovery() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = SaveStore::open(temp.path().join("saves")).unwrap();
        store.load().unwrap();
        let legacy = BTreeMap::from([
            (
                "extinction-protocol:slot:1:v1".into(),
                "truncated legacy JSON{".into(),
            ),
            (
                "extinction-protocol:slot:1:v1:backup".into(),
                "{\"valid\":true}".into(),
            ),
            ("mesozoic-protocol:training-offer-seen".into(), "1".into()),
        ]);
        store.write(legacy.clone()).unwrap();
        assert_eq!(store.load().unwrap().entries, Some(legacy));
    }

    #[test]
    fn interrupted_temporary_file_is_never_loaded_as_a_save() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = SaveStore::open(temp.path().join("saves")).unwrap();
        store.load().unwrap();
        store.write(entries("durable")).unwrap();
        fs::write(store.directory.join(".save-interrupted"), b"partial").unwrap();
        assert_eq!(store.load().unwrap().entries, Some(entries("durable")));
    }

    #[test]
    fn failed_primary_replacement_preserves_the_recovery_copy() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = SaveStore::open(temp.path().join("saves")).unwrap();
        store.load().unwrap();
        store.write(entries("durable")).unwrap();
        fs::remove_file(store.directory.join(PRIMARY)).unwrap();
        fs::create_dir(store.directory.join(PRIMARY)).unwrap();
        assert!(store.write(entries("newer")).is_err());
        assert!(
            matches!(read_document(&store.directory.join(BACKUP)), ReadResult::Valid(data) if data == entries("durable"))
        );
        assert_eq!(store.load().unwrap().entries, Some(entries("durable")));
    }
}
