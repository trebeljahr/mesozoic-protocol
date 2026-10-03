# Desktop save and Steam Cloud contract

The game writes campaign progress to native files before Steam synchronizes
them. Steam Auto-Cloud synchronizes files when the game starts and exits;
the game does not call the Remote Storage API. Local export or a successful
build does not mean Cloud settings or a depot have been published.

## Files and account ownership

The Tauri application data directory uses identifier
`com.ricoslabs.mesozoicprotocol`:

| Platform | Application data directory |
| --- | --- |
| Windows | `%APPDATA%\com.ricoslabs.mesozoicprotocol` |
| macOS | `~/Library/Application Support/com.ricoslabs.mesozoicprotocol` |
| Linux | `$XDG_DATA_HOME/com.ricoslabs.mesozoicprotocol`, normally `~/.local/share/com.ricoslabs.mesozoicprotocol` |

Standalone saves use `saves/`. Steam saves use `saves/steam/<64-bit Steam ID>/`.
Each directory contains `progress.json` and its last valid backup,
`progress.backup.json`. The versioned JSON envelope contains campaign slots,
progress, and the training-offer flag. Device settings, temporary writes, and
the process lock are excluded from Cloud.

The official launch markers `SteamAppId` or `SteamGameId` must equal `4798230`
before the game loads the SDK. Other applications and non-Steam shortcuts do
not opt in. The SDK must initialize for this application and return a valid
individual Steam account. Failures stop save initialization and can be retried;
they never select standalone saves. Successful identity resolution is cached
for the process. Offline network status does not disable local saves.

Steam profiles never automatically import shared WebView/localStorage data.
This prevents a second Steam account from inheriting the first account's
browser data. The standalone profile may migrate its legacy browser saves.

## Steamworks Auto-Cloud configuration

Configure app **4798230** with one root and two root overrides:

| Field | Value |
| --- | --- |
| Root | `WinAppDataRoaming` |
| Subdirectory | `com.ricoslabs.mesozoicprotocol/saves/steam/{64BitSteamID}` |
| Pattern | `progress*.json` |
| OS | All OSes |
| Recursive | No |
| Byte quota per user | At least `52428800` (50 MiB) |
| Number of files allowed per user | At least `16` |

Each save document is limited to 10 MiB. The quota leaves room for both files
and future format transitions.

| Original root | Override OS | New root | Add/Replace Path | Replace Path |
| --- | --- | --- | --- | --- |
| `WinAppDataRoaming` | macOS | `MacAppSupport` | Empty | No |
| `WinAppDataRoaming` | Linux | `LinuxXdgDataHome` | Empty | No |

Keep the same subdirectory and account placeholder in every platform preview.
Independent roots for each operating system partition Cloud files and prevent
cross-platform saves. Never enable recursion over all Steam account folders.
Leave Dynamic Cloud Sync disabled: live file replacement while the game is
running is not implemented. Steam's `steam_autocloud.vdf` belongs to the client
and is not an identity source or a save document.

Save and publish the Steamworks configuration separately from uploading the
game. Use developer-only Cloud support while testing an already released app.
See [Valve's Cloud documentation](https://partner.steamgames.com/doc/features/cloud)
for publication, root overrides, and `testappcloudpaths` testing.

## SDK packaging

`scripts/ci/prepare-steam-sdk.mjs` downloads the pinned crates.io
`steamworks-sys` **0.13.0** archive containing Valve SDK **1.64**. It verifies
the registry SHA-256 before decompressing, reads only exact regular-file
entries, and writes fixed output filenames. No SDK headers, bindings, import
libraries, or build scripts from the archive execute or enter the game.
`STEAM-SDK-NOTICE.txt` records provenance and Valve's copyright.

The Rust game uses `libloading`; it has no linked `steamworks` dependency.
Windows and Linux SDK libraries are added only to Steam depots, next to the
executable. Their standalone artifacts start without those libraries.

The macOS workflow prepares the universal dylib, then passes
`src-tauri/tauri.steam.conf.json` to Tauri. Tauri places it in
`Contents/Frameworks`, signs it before the app, and notarizes the complete
bundle. The notice is included under `Contents/Resources/licenses/`.
The same signed bundle ships standalone, where the SDK remains unloaded.
Steam depot staging must not add files inside or otherwise change that bundle.

The required SDK exports are `SteamAPI_InitFlat`, `SteamAPI_SteamUser_v023`,
`SteamAPI_ISteamUser_GetSteamID`, `SteamAPI_SteamUtils_v010`,
`SteamAPI_ISteamUtils_GetAppID`, and `SteamAPI_Shutdown`. The game performs a
synchronous identity query and shuts down the SDK before releasing the library.
It does not need authentication tickets, Web API keys, or an online connection
for this query. See [Valve's SDK documentation](https://partner.steamgames.com/doc/sdk/api).

## Release verification

Before enabling public Cloud support, validate the installed Steam build:

1. On each supported OS, create progress, exit, and confirm the two JSON files
   upload from the signed-in account's directory.
2. Sign into the same Steam account on another OS. Launch after synchronization
   and confirm the same campaign state loads.
3. Switch Steam accounts under the same OS user. The second account must start
   in its own profile and must not import the first account's WebView data.
4. Test Steam offline mode, Cloud disabled, an unavailable SDK, and retry after
   Steam becomes available. Identity failures must not write shared saves.
5. Run the standalone Windows/Linux artifacts without SDK files. Confirm they
   load only the standalone profile. Verify macOS signatures and notarization
   with the SDK already inside the bundle.
6. Confirm Steam launches cannot activate the standalone updater, and close
   the game normally before checking Cloud synchronization.

Unit tests use fake SDK implementations and temporary save files. Passing them
does not replace these Steam client and cross-device checks.
