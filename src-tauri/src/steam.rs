//! Steam identifies the save owner; Auto-Cloud handles synchronization separately.
//! The SDK is loaded at runtime so standalone and mobile builds do not link it.

use libloading::Library;
use std::ffi::{c_char, c_int, c_void};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const APP_ID: u32 = 4_798_230;
static IDENTITY: Mutex<Option<Option<u64>>> = Mutex::new(None);

fn is_steam_launch(app_id: Option<&str>, game_id: Option<&str>) -> bool {
    app_id == Some("4798230") || game_id == Some("4798230")
}

fn library_path(executable: &Path, platform: &str) -> Result<PathBuf, String> {
    let directory = executable
        .parent()
        .ok_or("Cannot locate game executable directory")?;
    match platform {
        "windows" => Ok(directory.join("steam_api64.dll")),
        "linux" => Ok(directory.join("libsteam_api.so")),
        "macos" if directory.file_name().is_some_and(|name| name == "MacOS") => Ok(directory
            .parent()
            .ok_or("Cannot locate app bundle")?
            .join("Frameworks/libsteam_api.dylib")),
        "macos" => Err("Steam saves require the packaged macOS app bundle".into()),
        _ => Err("Steam saves are unavailable on this platform".into()),
    }
}

fn valid_steam_id(id: u64) -> bool {
    let universe = id >> 56;
    let account_type = (id >> 52) & 0xf;
    let instance = (id >> 32) & 0xfffff;
    universe == 1 && account_type == 1 && (1..=4).contains(&instance) && id as u32 != 0
}

trait SteamApi {
    fn init(&self) -> Result<(), String>;
    fn app_id(&self) -> Result<u32, String>;
    fn steam_id(&self) -> Result<u64, String>;
    fn shutdown(&self);
}

fn query_identity(api: &impl SteamApi) -> Result<u64, String> {
    api.init()?;
    // These synchronous calls need no network connection or callback pump.
    // Always shut down a successful initialization, including validation errors.
    let result = (|| {
        if api.app_id()? != APP_ID {
            return Err("Steam initialized for a different game".into());
        }
        let id = api.steam_id()?;
        if !valid_steam_id(id) {
            return Err("Steam returned an invalid account identity".into());
        }
        Ok(id)
    })();
    api.shutdown();
    result
}

type Init = unsafe extern "C" fn(*mut c_char) -> c_int;
type Interface = unsafe extern "C" fn() -> *mut c_void;
type GetSteamId = unsafe extern "C" fn(*mut c_void) -> u64;
type GetAppId = unsafe extern "C" fn(*mut c_void) -> u32;
type Shutdown = unsafe extern "C" fn();

struct NativeApi {
    // Retain the library until after query_identity calls SteamAPI_Shutdown.
    _library: Library,
    init: Init,
    user: Interface,
    get_steam_id: GetSteamId,
    utils: Interface,
    get_app_id: GetAppId,
    shutdown: Shutdown,
}

impl NativeApi {
    fn load(path: &Path) -> Result<Self, String> {
        // SAFETY: Only the explicit packaged SDK path is loaded. The FFI types
        // below match the pinned Steamworks SDK's exported flat C interface.
        unsafe {
            let library = Library::new(path)
                .map_err(|error| format!("Cannot load Steam SDK at {}: {error}", path.display()))?;
            fn symbol<T: Copy>(library: &Library, name: &[u8]) -> Result<T, String> {
                // SAFETY: Callers request only the SDK signatures declared above.
                unsafe { library.get::<T>(name).map(|value| *value) }
                    .map_err(|error| format!("Steam SDK is incompatible: {error}"))
            }
            Ok(Self {
                init: symbol(&library, b"SteamAPI_InitFlat\0")?,
                user: symbol(&library, b"SteamAPI_SteamUser_v023\0")?,
                get_steam_id: symbol(&library, b"SteamAPI_ISteamUser_GetSteamID\0")?,
                utils: symbol(&library, b"SteamAPI_SteamUtils_v010\0")?,
                get_app_id: symbol(&library, b"SteamAPI_ISteamUtils_GetAppID\0")?,
                shutdown: symbol(&library, b"SteamAPI_Shutdown\0")?,
                _library: library,
            })
        }
    }
}

impl SteamApi for NativeApi {
    fn init(&self) -> Result<(), String> {
        let mut message = [0 as c_char; 1024];
        // SAFETY: SteamErrMsg is a 1024-byte writable buffer; the SDK stays loaded.
        let status = unsafe { (self.init)(message.as_mut_ptr()) };
        if status == 0 {
            return Ok(());
        }
        let bytes: Vec<u8> = message
            .iter()
            .take_while(|byte| **byte != 0)
            .map(|byte| *byte as u8)
            .collect();
        Err(format!(
            "Cannot initialize Steam ({status}): {}",
            String::from_utf8_lossy(&bytes)
        ))
    }

    fn app_id(&self) -> Result<u32, String> {
        // SAFETY: query_identity calls this only after successful initialization.
        unsafe {
            let utils = (self.utils)();
            if utils.is_null() {
                return Err("Steam utilities interface is unavailable".into());
            }
            Ok((self.get_app_id)(utils))
        }
    }

    fn steam_id(&self) -> Result<u64, String> {
        // SAFETY: query_identity calls this only after successful initialization.
        unsafe {
            let user = (self.user)();
            if user.is_null() {
                return Err("Steam user interface is unavailable".into());
            }
            Ok((self.get_steam_id)(user))
        }
    }

    fn shutdown(&self) {
        // SAFETY: query_identity calls this once after successful initialization,
        // before NativeApi and its Library are dropped.
        unsafe { (self.shutdown)() }
    }
}

fn cached_identity(
    cache: &Mutex<Option<Option<u64>>>,
    steam_launch: bool,
    query: impl FnOnce() -> Result<u64, String>,
) -> Result<Option<u64>, String> {
    let mut identity = cache
        .lock()
        .map_err(|_| "Steam save identity lock failed")?;
    if let Some(cached) = *identity {
        return Ok(cached);
    }
    let resolved = if steam_launch { Some(query()?) } else { None };
    *identity = Some(resolved);
    Ok(resolved)
}

/// None is reserved for standalone launches. Steam errors remain retryable and
/// must never select the unscoped standalone save directory.
pub(crate) fn read_save_identity() -> Result<Option<u64>, String> {
    let app_id = std::env::var("SteamAppId").ok();
    let game_id = std::env::var("SteamGameId").ok();
    cached_identity(
        &IDENTITY,
        is_steam_launch(app_id.as_deref(), game_id.as_deref()),
        || {
            let executable = std::env::current_exe().map_err(|error| error.to_string())?;
            let path = library_path(&executable, std::env::consts::OS)?;
            query_identity(&NativeApi::load(&path)?)
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const ID: u64 = 76_561_198_027_391_269;

    struct FakeApi {
        init_ok: bool,
        app_id: u32,
        identity: Result<u64, String>,
        shutdowns: Cell<usize>,
    }
    impl SteamApi for FakeApi {
        fn init(&self) -> Result<(), String> {
            if self.init_ok {
                Ok(())
            } else {
                Err("offline client unavailable".into())
            }
        }
        fn app_id(&self) -> Result<u32, String> {
            Ok(self.app_id)
        }
        fn steam_id(&self) -> Result<u64, String> {
            self.identity.clone()
        }
        fn shutdown(&self) {
            self.shutdowns.set(self.shutdowns.get() + 1);
        }
    }
    fn fake() -> FakeApi {
        FakeApi {
            init_ok: true,
            app_id: APP_ID,
            identity: Ok(ID),
            shutdowns: Cell::new(0),
        }
    }

    #[test]
    fn only_this_games_official_launch_markers_enable_steam() {
        assert!(is_steam_launch(Some("4798230"), None));
        assert!(is_steam_launch(None, Some("4798230")));
        for marker in [
            None,
            Some(""),
            Some("480"),
            Some("123456789000000"),
            Some(" 4798230"),
        ] {
            assert!(!is_steam_launch(marker, marker));
        }
    }

    #[test]
    fn standalone_never_calls_sdk_and_success_is_cached() {
        let cache = Mutex::new(None);
        assert_eq!(
            cached_identity(&cache, false, || panic!("SDK must stay unloaded")),
            Ok(None)
        );
        let cache = Mutex::new(None);
        assert_eq!(cached_identity(&cache, true, || Ok(ID)), Ok(Some(ID)));
        assert_eq!(
            cached_identity(&cache, true, || panic!("identity already resolved")),
            Ok(Some(ID))
        );
    }

    #[test]
    fn sdk_failure_can_be_retried_without_falling_back_to_standalone() {
        let cache = Mutex::new(None);
        assert!(cached_identity(&cache, true, || Err("missing SDK".into())).is_err());
        assert_eq!(cached_identity(&cache, true, || Ok(ID)), Ok(Some(ID)));
    }

    #[test]
    fn identity_queries_validate_game_user_and_shutdown() {
        let mut api = fake();
        assert_eq!(query_identity(&api), Ok(ID));
        assert_eq!(api.shutdowns.get(), 1);
        api.app_id = 480;
        assert!(query_identity(&api).unwrap_err().contains("different game"));
        api.app_id = APP_ID;
        api.identity = Err("null user interface".into());
        assert!(query_identity(&api).is_err());
        api.identity = Ok(0);
        assert!(query_identity(&api)
            .unwrap_err()
            .contains("invalid account"));
        assert_eq!(api.shutdowns.get(), 4);
        api.init_ok = false;
        assert!(query_identity(&api).is_err());
        assert_eq!(api.shutdowns.get(), 4);
    }

    #[test]
    fn reject_group_server_and_malformed_steam_ids() {
        assert!(valid_steam_id(ID));
        for id in [0, 1, u64::MAX, 0x0110_0001_0000_0000, 0x0170_0000_0000_0001] {
            assert!(!valid_steam_id(id));
        }
    }

    #[test]
    fn sdk_paths_are_fixed_relative_to_the_executable() {
        assert_eq!(
            library_path(Path::new("/game/game.exe"), "windows").unwrap(),
            Path::new("/game/steam_api64.dll")
        );
        assert_eq!(
            library_path(Path::new("/game/game"), "linux").unwrap(),
            Path::new("/game/libsteam_api.so")
        );
        assert_eq!(
            library_path(Path::new("/game/Game.app/Contents/MacOS/game"), "macos").unwrap(),
            Path::new("/game/Game.app/Contents/Frameworks/libsteam_api.dylib")
        );
        assert!(library_path(Path::new("/game/game"), "macos").is_err());
    }
}
