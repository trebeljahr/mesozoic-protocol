# Distribution

> **Automating this for a new repo?** [Hatchkit](https://hatchkit.trebeljahr.com) ships this exact pipeline as a one-shot command. Run `hatchkit signing org-init` once per machine (Apple .p12 / .p8, Play SA JSON, Azure SP) and then `hatchkit signing apply` from any project to wire build-{windows,ios,android}.yml + bundle ID rewrites + ASC Bundle ID / App record / Provisioning Profile creation + Android upload keystore + ~20 GitHub repo secrets. The vendor-side manual residue below is exactly what Hatchkit leaves you to do — the rest is automated.

The rest of this doc remains the canonical manual fallback for anyone not using Hatchkit. Hatchkit copies the three signed-build workflow files byte-for-byte (only the bundle ID, app name, pnpm version, and node version are templated). The preflight jobs inside them, plus `ci.yml`, `build-linux.yml`, `build-macos.yml`, `release.yml`, `steam.yml`, and `scripts/sync-version.mjs`, are this repo's own additions on top.

How to ship Mesozoic Protocol to desktop (Tauri / Steam) and mobile (Capacitor / iOS / Android).

The web build is a static Vite bundle in `dist/`. Both shells just wrap that bundle:

- Tauri loads `dist/` inside a native WebView (Wry on macOS/Windows/Linux).
- Capacitor loads `dist/` inside iOS WKWebView or Android WebView.

So `pnpm build` always runs first; both shells then sync the result.

## Running a store test build

Use the existing main branch for a test upload without creating a public
release tag:

```bash
gh workflow run build-ios.yml --repo trebeljahr/mesozoic-protocol --ref main -f upload=true
gh workflow run build-android.yml --repo trebeljahr/mesozoic-protocol --ref main -f upload=true -f track=internal
```

For the first manual Android upload, pass `-f upload=false`, download the
`android-aab` artifact, and upload it in Play Console. The first manual
upload is complete for this app. Keep the existing upload keystore.

The iOS distribution profile must target
`4BHY8H2J25.com.ricoslabs.mesozoicprotocol`. Its configured name is
`Mesozoic Protocol App Store`. CI checks this before archiving. A successful
upload still needs processing in TestFlight, a tester group, and device QA.
Match the App Store version draft to the build's marketing version before
submission; do not equate an internal build with a production release.

Both manual workflows default to `upload=false`. The Android workflow saves
a signature-verified APK and AAB before upload; iOS saves a verified IPA. If upload fails, preserve the artifact and inspect the
store response before rebuilding. Reruns get a higher build number.

For rollback, pause a bad testing rollout or restore a previously tested
Steam build. Mobile stores require a new, higher build number for replacement
binaries; an older artifact cannot overwrite an accepted build number.

The current store checklist and account blockers live in the project vault's
`mesozoic-protocol-store-rollout-audit.md`. Store agreement, payment, artwork,
and review requirements are separate from CI success.

## Versioning

The version has to be stated in five places that can silently drift apart:

| Where | What |
| --- | --- |
| `package.json` | `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` — ends up in the DMG / MSI / AppImage filenames |
| `src-tauri/Cargo.toml` | `[package] version` |
| `src-tauri/Cargo.lock` | the `mesozoic-protocol` `[[package]]` entry — cargo refuses to build if this disagrees with Cargo.toml |
| `ios/App/App.xcodeproj/project.pbxproj` | `MARKETING_VERSION`, in both the Debug and Release build configs |

Android is the exception: `versionName` is read from `package.json` at build
time via the `ANDROID_VERSION_NAME` env var read by
[android/app/build.gradle](android/app/build.gradle), so there is no sixth file
to edit.

[scripts/sync-version.mjs](scripts/sync-version.mjs) is the single entry point:

```bash
node scripts/sync-version.mjs 0.2.0      # write 0.2.0 to all five files
node scripts/sync-version.mjs --from-tag # take it from GITHUB_REF_NAME or the current git tag
node scripts/sync-version.mjs --check    # verify agreement, write nothing, exit 1 on drift
```

It is dependency-free (plain string editing, no TOML/pbxproj parser),
idempotent, and prints every file it changes. It refuses anything that is not
plain `X.Y.Z` — Apple's `MARKETING_VERSION` and Play's `versionName` both reject
suffixed versions. `--check` also asserts that the Android env-var wiring is
still in place, so nobody can quietly reintroduce a hardcoded `versionName`.

`--check` runs in CI and in every build workflow's preflight job, so a
half-applied bump fails in about 90 seconds instead of producing a mislabelled
store submission.

## Continuous integration

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every push to
`main`, every pull request, and every `v*` tag: `pnpm lint` (biome), a
typecheck, `node scripts/sync-version.mjs --check`, `pnpm test`, and
`pnpm build`.

`pnpm test` is vitest (`vitest.config.ts`, node environment, no browser) over
the pure simulation and persistence layers — path geometry, wave tables across
every level and mode, the progress/migration code, upgrade and meta-skill
tables, and i18n key parity. It runs in under a second, so it sits in every
preflight gate as well: nothing gets code-signed for three stores without it
passing first.

The typecheck is `pnpm exec tsc -b`, **not** `tsc -b --noEmit`.
`tsconfig.node.json` is a composite referenced project, and TypeScript rejects
`--noEmit` for those (`TS6310: Referenced project may not disable emit`). Plain
`tsc -b` is the correct non-emitting invocation here — the root project already
sets `"noEmit": true`, so the only output is the referenced project's
declaration build into the gitignored `.tsbuild/` directory. It is the same
invocation `pnpm build` runs.

Each of the five platform build workflows additionally carries its own
lightweight `preflight` job, on a Linux runner, running the same lint /
typecheck / version check / tests **plus a presence check for every secret that
workflow needs**. The signing job has `needs: preflight`.

This is deliberately duplicated rather than factored into a `workflow_call` of
`ci.yml`. A reusable-workflow call would run the full web build five extra
times per tag and put it on the critical path of every signed build; the
preflight jobs skip the web build entirely, finish in about 90 seconds, and
keep each workflow self-contained and independently `workflow_dispatch`-able.

The secret check exists because base64 secrets fail silently when unset: an
unset secret decodes to a zero-byte file and surfaces much later as a corrupt
keystore, a failed `security import`, or an opaque signtool HRESULT. The check
names the missing secret and never echoes a value.

## Desktop (Tauri → Steam)

### One-time prerequisites

- Rust toolchain + Tauri prerequisites: <https://tauri.app/start/prerequisites/>
- macOS: Xcode Command Line Tools (already required for `xcodebuild`).
- Windows: WiX Toolset 3 (for `.msi`) and/or NSIS (for `.exe` installer). Tauri downloads both on first run.

### Build

```bash
pnpm tauri build
```

Outputs land in `src-tauri/target/release/bundle/`:

- macOS: `bundle/macos/Mesozoic Protocol.app` and `bundle/dmg/Mesozoic Protocol_<version>_<arch>.dmg`
- Windows: `bundle/msi/Mesozoic Protocol_<version>_x64_en-US.msi` and `bundle/nsis/Mesozoic Protocol_<version>_x64-setup.exe`
- Linux: `bundle/appimage/mesozoic-protocol_<version>_amd64.AppImage` and `bundle/deb/mesozoic-protocol_<version>_amd64.deb`

The bundle metadata (category=Game, copyright, publisher, descriptions, min system version) is in `src-tauri/tauri.conf.json` under `bundle.*`.

### Cross-compiling

Tauri bundles per host. Locally:

- Run `pnpm tauri build` on a Mac for `.app`/`.dmg`.
- Run `pnpm tauri build` on Windows (or a Windows VM) for `.msi`/`.exe`.
- Run `pnpm tauri build` on Linux for `.AppImage`/`.deb`.

In CI this is one workflow per host OS — [build-macos.yml](.github/workflows/build-macos.yml),
[build-windows.yml](.github/workflows/build-windows.yml),
[build-linux.yml](.github/workflows/build-linux.yml) — all triggered by the same
`v*` tag.

### Linux build

[.github/workflows/build-linux.yml](.github/workflows/build-linux.yml) produces
an AppImage and a `.deb`. **No secrets and no signing**: Linux has no Gatekeeper
or SmartScreen equivalent, so there is nothing to sign against. These artifacts
are what the Linux Steam depot ships and what itch.io serves on the `linux`
channel.

Runs on **`ubuntu-22.04`, pinned — not `ubuntu-latest`**, for two reasons:

- Tauri v2 links against `webkit2gtk-4.1`. Ubuntu 24.04 ships a newer
  webkit/libsoup stack; 22.04 is the oldest runner image that still packages 4.1.
- The produced binary requires at least the glibc of the build machine. Building
  on 22.04 (glibc 2.35) runs on 22.04 and newer; building on 24.04 (glibc 2.39)
  would silently drop every user still on an older LTS.

Bump that pin only as a conscious decision to drop those users.

The workflow installs the Tauri Linux prerequisites (`build-essential`,
`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libappindicator3-dev`,
`libayatana-appindicator3-dev`, `librsvg2-dev`, `libssl-dev`, `patchelf`) and
uses the same rust toolchain and cargo caching pattern as `build-macos.yml`.

Artifacts: `linux-bundles` (AppImage + `.deb`, for the GitHub Release and
itch.io) and `linux-portable` (the raw executable, for the Steam depot).

### Code signing — Windows via Azure Artifact Signing

Steam distributes through its own DRM and doesn't require notarization, but unsigned binaries trigger Gatekeeper / SmartScreen warnings if a user runs the bundle outside Steam.

Windows builds use the shared Azure Artifact Signing account `ricoslabs-signing`, West Europe endpoint `https://weu.codesigning.azure.net/`, and Active Public Trust profile `ricoslabs-public`. The publisher is `Ricos Labs LLC`. Do not create another profile for this app.

**CI identity:** `mesozoic-protocol-signing`, client ID `1aa3ffa3-7841-4c8c-82f2-91a9f64b9146`, tenant `ce0c906e-8a84-4877-afd9-cdf103ddaacb`. Its only Azure role is **Artifact Signing Certificate Profile Signer**, scoped to:

```text
/subscriptions/4aaef5a5-286b-46a0-b9e4-84622e8fdc4f/resourceGroups/ricoslabs-signing/providers/Microsoft.CodeSigning/codeSigningAccounts/ricoslabs-signing/certificateProfiles/ricoslabs-public
```

Authentication uses GitHub OIDC, with issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`, and exact subject `repo:trebeljahr/mesozoic-protocol:environment:windows-signing`. The GitHub `windows-signing` environment allows branch `main` and tags matching `v*`. It stores `AZURE_CLIENT_ID` as an environment variable. No client secret is created or shared with another app. The signing job alone receives `id-token: write`.

**Tauri integration:** `src-tauri/tauri.conf.json` invokes `scripts/ci/sign-windows.ps1` from Tauri's `src-tauri` working directory. The helper resolves the newest supported x64 SDK SignTool and reads paths from PowerShell environment variables. CI installs the pinned signing client and .NET 8, then creates metadata from `scripts/ci/windows-signing.json`. Metadata selects `AzureCliCredential`, using the preceding `azure/login` OIDC session. Microsoft documents the [SignTool integration and credential selection](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations).

Tauri restores the original Cargo executable after bundling. CI therefore signs the final portable executable once more before verification and upload. The signing helper also verifies each file immediately after signing, including executables embedded during installer creation.

**Verification:** `scripts/ci/verify-windows-signatures.ps1` requires the app executable, at least one MSI, and at least one NSIS installer. Every file must pass `signtool verify /pa /all /v /tw`, have valid Authenticode status, exact publisher `Ricos Labs LLC`, and a timestamp certificate. Missing files or wrong publishers fail the job before bundle upload. The `windows-signature-evidence` artifact records hashes, signer identity, timestamp identity, commit, and run ID.

After this workflow is pushed with authorization, run `gh workflow run build-windows.yml --ref main`. This dispatch builds and signs artifacts only; it does not trigger the separate tag-driven release workflow. Inspect the successful verification log and evidence artifact before claiming a signed build. Tag pushes can trigger publication workflows and require separate authorization.

#### What signing does and does not buy you

**Nothing dismisses SmartScreen on first download. Not even an EV certificate.** Microsoft, verbatim, on [SmartScreen reputation for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation): *"EV certificates no longer bypass SmartScreen… Paying a premium for EV solely to avoid SmartScreen warnings is no longer justified."* Their own comparison table puts Artifact Signing, a $150–300/yr OV cert, and a $400+/yr EV cert in the same bucket. Artifact Signing will never issue EV certificates and Microsoft states there is no plan to.

What actually happens: reputation accrues against **both** the file hash and the publisher identity. Per-hash reputation resets on every release; per-identity reputation carries over. Microsoft's own estimate for a new publisher is *"several weeks and hundreds of clean installs from a wide audience."* There is no consumer submission path to accelerate it.

Consequences for this project:

- **Sign every release with the same identity and never rotate it.** Rotating throws away the only reputation signal that persists across builds.
- **Never modify a binary after `signtool` runs.** The updater `.sig` is generated over the already-signed installer — that order is correct, don't invert it.
- **Steam is the escape hatch.** Steam-installed builds never touch SmartScreen's download path. Direct downloads will show the warning for the first several weeks regardless, so the download page should say so and name the publisher to verify.
- Windows 11's Smart App Control can supersede SmartScreen entirely, and unlike SmartScreen it applies to all executables, not just downloaded ones.

**Local signing on Windows:** install Windows SDK 10.0.22621 or later, .NET 8, and signing client 1.0.60. Authenticate Azure CLI as an identity authorized on the profile, set `AZURE_CODE_SIGNING_DLIB` and `AZURE_CODE_SIGNING_METADATA`, and run `pnpm tauri build`. Do not reuse the CI identity with a client secret. Signature checks can then run with `pwsh -File scripts/ci/verify-windows-signatures.ps1` from the repository root.

### Code signing — macOS via Developer ID + notarization

Automated in [.github/workflows/build-macos.yml](.github/workflows/build-macos.yml). Reuses the iOS Apple Developer team enrollment and the App Store Connect API key — only one new cert per team (Developer ID Application).

**Outside Mac App Store distribution** (Steam, itch.io, direct download). For Mac App Store you'd need a separate cert + sandbox entitlements + App Review — out of scope here.

**One-time Apple setup** (additive to iOS work):

1. <https://developer.apple.com/account/resources/certificates/list> → **+** → **Developer ID Application** → reuse the same CSR you used for the iOS Distribution cert, or generate a new one.
2. Download `developerID_application.cer` → double-click to import into Keychain.
3. **Keychain Access → login → My Certificates** → find `Developer ID Application: Ricos Labs LLC (<TEAM_ID>)` → right-click → Export as `DeveloperID.p12` with password.
4. Base64-encode for the secret:
   ```bash
   base64 -i DeveloperID.p12 | pbcopy
   ```
5. Get the exact identity string for the third secret:
   ```bash
   security find-identity -v -p codesigning login.keychain | grep "Developer ID Application"
   ```
   Format: `Developer ID Application: Ricos Labs LLC (4BHY8H2J25)`.

**New GitHub secrets** (3): `APPLE_DEVELOPER_ID_CERT_BASE64`, `APPLE_DEVELOPER_ID_CERT_PASSWORD`, `APPLE_DEVELOPER_ID_IDENTITY`.

**Reuses existing secrets**: `APPLE_TEAM_ID`, `APPLE_KEYCHAIN_PASSWORD`, `APPSTORE_API_KEY_ID`, `APPSTORE_API_ISSUER_ID`, `APPSTORE_API_KEY_P8_BASE64`. Notarization uses the same ASC API key as TestFlight uploads — no second key needed.

**Tauri config**: `bundle.macOS.entitlements` in [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) points at [src-tauri/entitlements.plist](src-tauri/entitlements.plist) — hardened runtime entitlements required for notarization. The current set allows JIT (WebKit needs it), unsigned executable memory, library validation bypass (for dynamically loaded Wry frameworks), and outbound network (Plausible). Tighten over time if you remove features.

**Universal binary**: workflow builds `universal-apple-darwin` so the same DMG runs on Apple Silicon and Intel Macs. ~2× build time but one artifact covers everything.

**Output**: `src-tauri/target/universal-apple-darwin/release/bundle/dmg/Mesozoic Protocol_<version>_universal.dmg`. Signed, notarized, stapled — Gatekeeper accepts on first launch with no warning.

**Local signing** (same machine that has the cert imported and ASC API key on disk at `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`):
```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Ricos Labs LLC (4BHY8H2J25)"
export APPLE_API_ISSUER=<issuer-uuid>
export APPLE_API_KEY=<key-id>
export APPLE_API_KEY_PATH=~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8
pnpm tauri build --target universal-apple-darwin
```

**Distribution channels that accept this DMG**: Steam (signs are nice-to-have), **itch.io** (no extra signing required; notarization means users get no Gatekeeper warning), Humble, GOG, or your own download host. The DMG is universally distributable — no per-channel signing variant.

### Steam upload

Automated in [.github/workflows/steam.yml](.github/workflows/steam.yml). It
triggers on `v*` tags, waits for the three desktop builds, stages one directory
per platform, and uploads all three depots.

It **soft-skips with a `::notice::` and exits 0** while Steamworks is not set
up, so it can sit on `main` before the Steam Direct app exists. It activates
once all of these are set:

| Name | Kind | Value |
| --- | --- | --- |
| `STEAM_APP_ID` | repo variable | numeric Steam App ID |
| `STEAM_USERNAME` | secret | build account login name |
| `STEAM_CONFIG_VDF` | secret | base64 of that account's Steam Guard–authenticated `config.vdf` |
| `STEAM_RELEASE_BRANCH` | repo variable, optional | beta branch to set live automatically; leave unset to promote by hand |

The one-time Steamworks setup, how to produce `config.vdf`, and the depot-ID
convention are documented in [steam/README.md](steam/README.md).

**Depot contents are the unpacked game, not the installers.** Steam does the
installing; an `.msi` or an AppImage inside a depot ships the player something
they have to run by hand. That is why `build-windows.yml` and `build-linux.yml`
each upload a second `*-portable` artifact (raw executable) alongside the
installer bundles, and the macOS depot takes the `.app` out of `macos-bundles`
rather than the `.dmg`. GitHub artifacts do not preserve the POSIX executable
bit, so `steam.yml` restores it on the macOS and Linux binaries before
uploading — without that, Steam ships an unlaunchable build.

It uses `game-ci/steam-deploy` rather than driving `steamcmd` directly. The
fiddly part of a Steam upload in CI is not the depot layout, it is getting
`steamcmd` past Steam Guard non-interactively; that action encapsulates exactly
that problem and is maintained.

[steam/](steam/) holds commented `app_build.vdf` and per-platform depot vdf
templates with `<APP_ID>` / `<DEPOT_ID>` placeholders. CI does not read them —
they cover the manual `steamcmd +run_app_build` path and are the written-down
record of your depot IDs, which matters if your depots are not the default
`<APP_ID>+1/+2/+3`. Filled-in copies (`steam/app_build_*.vdf`) are gitignored
because they carry the real App ID and local absolute paths.

`steam_appid.txt` is gitignored and must stay that way — see the note at the end
of [steam/README.md](steam/README.md).

Promoting an uploaded build to a live branch stays a manual step in the
Steamworks dashboard unless you set `STEAM_RELEASE_BRANCH`.

### Steam store links and platform features

The assigned Steam app is `4798230`. Demo wishlist links use that app's
[store URL](https://store.steampowered.com/app/4798230/Mesozoic_Protocol/).
They remain disabled unless the build sets `VITE_STEAM_STORE_READY=1`.
Before enabling it, verify the Coming Soon page is public without a partner
login. For example: `VITE_DEMO=1 VITE_STEAM_STORE_READY=1 pnpm build`.
This flag does not publish the page. The static about/press buttons have their
own release step and remain disabled until the page is verified.

The game has local achievements and durable desktop save files. Steam builds
read the current account's Steam ID through the SDK and keep that account's
saves in its own directory. Steam Auto-Cloud synchronizes the files after
Steamworks rules are configured and published. See [the Cloud contract](steam/CLOUD.md).
The achievement API bridge is still absent. An uploaded depot alone does not
confirm Cloud synchronization or achievement support.

[Steam achievements](https://partner.steamgames.com/doc/features/achievements)
require configured achievement IDs and runtime API calls.
[Steam Cloud](https://partner.steamgames.com/doc/features/cloud) supports both
an API and Auto-Cloud file rules; an SDK is not required for Auto-Cloud.
Either route needs Steamworks configuration and a real two-device sync test.
Do not point Auto-Cloud at the WebView profile or all account folders. Only the
current account's two campaign JSON files belong in Cloud storage. Machine
preferences and the native write lock remain local.

Before claiming platform support, verify a packaged build through Steam:
achievement unlock and persistence, offline play followed by reconnect,
cloud conflict choice, and restore on a second clean installation. The
updater must remain disabled in Steam installs. Keep `steam_appid.txt`
untracked and excluded from depots.

## Mobile (Capacitor → iOS / Android)

Capacitor bundles the Vite build inside a native shell. No RN rewrite, no Expo. The web app already handles touch input, fullscreen, landscape detection, and responsive panels (see notes items 10, 11, 13).

### One-time prerequisites

- iOS: Xcode 15+, an Apple Developer account ($99/yr) for App Store distribution. CocoaPods is **not** required — Capacitor 8 uses Swift Package Manager.
- Android: JDK 21+ and Android Studio (or just the Android SDK + `gradle`). Set `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) to the SDK directory.

The first time you sync on a new machine, install the Android SDK platform tools through Android Studio's SDK Manager.

### Day-to-day workflow

```bash
# Build the web bundle and copy it into ios/ + android/
pnpm build && npx cap sync

# Open the native project in its IDE, then Run / Archive from there.
npx cap open ios
npx cap open android
```

Common subcommands:

- `npx cap copy ios|android` — copy `dist/` into the platform without re-installing native plugins (faster than `sync`).
- `npx cap sync ios|android` — copy + reinstall plugins (use after adding a Capacitor plugin).
- `npx cap run ios --target=<udid>` / `npx cap run android` — build + launch on a device/emulator from the CLI.

### iOS distribution — App Store Connect via CI

Bundle ID is `com.ricoslabs.mesozoicprotocol` (matches the Tauri identifier and the Android `applicationId` — keep them in sync).

It was `com.mesozoicprotocol.app` until 2026-09-22, when it moved before anything had shipped, so there is no compatibility shim anywhere. The new id is registered under the Ricos Labs LLC Apple team (`4BHY8H2J25`) and is the Google Play package name (Play app id `4972014174140347180`); the App Store Connect record already points at it. Registered is final: an App ID, an App Store Connect record and a Play package name cannot be renamed, so the id is now a contract — the Xcode project, `capacitor.config.ts`, `android/app/build.gradle`, the `MainActivity` package, `strings.xml`, the Tauri identifier, the export-options template and both store workflows all state it.

Automated in [.github/workflows/build-ios.yml](.github/workflows/build-ios.yml). Flow: build web bundle → `npx cap sync ios` → import distribution cert into a temp keychain → install provisioning profile → render `ExportOptions.plist` with [scripts/ci/ios-signing.py](scripts/ci/ios-signing.py) → `xcodebuild archive` → `xcodebuild -exportArchive` → upload .ipa to TestFlight via the App Store Connect API.

**One-time Apple setup:**

1. **Apple Developer Portal → Certificates** → create `Apple Distribution` certificate, download, import to Keychain, then export as `.p12` with a password (right-click the cert in Keychain Access → Export).
2. **Identifiers** → register `com.ricoslabs.mesozoicprotocol` (Capabilities: Push if needed; default otherwise).
3. **Profiles** → create an `App Store` distribution profile bound to that ID + the distribution cert. Note the profile's `Name` field — must match `APPLE_PROVISIONING_PROFILE_NAME` exactly.
4. **App Store Connect → Users and Access → Keys** → generate API key, role `App Manager`. Download the `AuthKey_<ID>.p8` (one-time only). Note Key ID + Issuer ID.
5. **App Store Connect → My Apps** → create the app record (SKU, primary language, bundle ID) so TestFlight has a target.

**Required GitHub secrets:** `APPLE_TEAM_ID`, `APPLE_CERT_P12_BASE64`, `APPLE_CERT_P12_PASSWORD`, `APPLE_PROVISIONING_PROFILE_B64`, `APPLE_PROVISIONING_PROFILE_NAME`, `APPLE_KEYCHAIN_PASSWORD`, `APPSTORE_API_KEY_ID`, `APPSTORE_API_ISSUER_ID`, `APPSTORE_API_KEY_P8_BASE64`.

```bash
# How to base64-encode the secrets (macOS):
base64 -i Distribution.p12 | pbcopy            # → APPLE_CERT_P12_BASE64
base64 -i profile.mobileprovision | pbcopy     # → APPLE_PROVISIONING_PROFILE_B64
base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy       # → APPSTORE_API_KEY_P8_BASE64
```

`CFBundleVersion` uses elapsed UTC minutes since 2020, split into Apple’s 4.2.2 digit format. Platform-wide concurrency reserves each minute until it ends, so retries and reusable workflow callers do not reuse a build number. `MARKETING_VERSION` (the visible version) lives in `project.pbxproj` and is written by [scripts/sync-version.mjs](scripts/sync-version.mjs) — see [Versioning](#versioning). The workflow's preflight job runs `--check`, so a tag whose pbxproj was not bumped fails before the archive starts rather than shipping a mislabelled TestFlight build.

**Local fallback:** Xcode → set Team, Product → Archive → Distribute App → App Store Connect.

### Android distribution — Play Console via CI

Automated in [.github/workflows/build-android.yml](.github/workflows/build-android.yml). Flow: build web bundle → `npx cap sync android` → decode keystore from secrets → write `android/keystore.properties` → `./gradlew bundleRelease assembleRelease` → verify both signatures → optionally upload signed `.aab` to the Play Console internal track.

**One-time setup:**

1. Generate the upload keystore (do this once and **back it up off-machine**; losing it locks you out of updates):
   ```bash
   keytool -genkey -v -keystore mesozoic-protocol.keystore -alias upload \
           -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Base64-encode the keystore for the secret:
   ```bash
   base64 -i mesozoic-protocol.keystore | pbcopy   # → ANDROID_KEYSTORE_BASE64
   ```
3. **Play Console** → create app, link package `com.ricoslabs.mesozoicprotocol`, configure the internal testing track.
4. **Play Console → Setup → API access** → link a Google Cloud project → create a service account → grant it `Release manager` (or narrower: `Release apps to testing tracks`). Download the service account JSON.
5. **First release must be uploaded manually through the Play Console UI** so Google can validate the app and distribution terms can be accepted. Subsequent versions can flow through this workflow.

**Required GitHub secrets:** `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON`.

`versionCode` is elapsed UTC minutes since 2020. Platform-wide concurrency reserves each minute until it ends, so retries and reusable workflow callers do not reuse a build number. `versionName` comes from `package.json` for both tagged and manual builds. The helper rejects a release tag that does not match that version. Both values reach [android/app/build.gradle](android/app/build.gradle) through environment variables.

For the first upload, dispatch **Build Android** with `upload=false` (the default). The four Android signing secrets are required; the Play service-account secret is only required when uploading. Download the signed `android-aab` artifact and upload it in Play Console. Later dispatches can set `upload=true` and select a track. Tag builds upload to internal testing. Signed AAB and IPA artifacts are preserved before store upload, so a store rejection does not discard the build.

**Local fallback:** drop a `mesozoic-protocol.keystore` + `keystore.properties` in `android/` (see workflow for format), then `cd android && ./gradlew bundleRelease`. Or use Android Studio: Build → Generate Signed Bundle / APK.

### Native icons and splash screens

Both native projects shipped with Capacitor's placeholder icon for a while — the blue "X". Either store rejects a submission that still carries it.

All native art is generated from one file, `src-tauri/icons/source.png` (1024×1024, transparent outside its own rounded corners):

```bash
pnpm sync:native-assets   # node scripts/sync-native-assets.mjs
```

That writes 31 files and is idempotent:

- **iOS icon** — `AppIcon-512@2x.png`, flattened onto the card-edge colour `#29364d` and stripped of its alpha channel (App Store Connect rejects icons with alpha). Flattening onto the darker `#0b1016` would leave visible wedges outside the art's baked corner radius once iOS applies its own squircle mask.
- **iOS splash** — the three `Splash.imageset` files, brand background with the icon centred.
- **Android launcher icons** — legacy `ic_launcher` + circularly masked `ic_launcher_round` at all five densities, plus adaptive `ic_launcher_foreground` sized 78/108 so the card fills the launcher mask without clipping the turret. The adaptive background layer is `@color/ic_launcher_background`, set to the same `#29364d`, so the two layers read as one full-bleed icon.
- **Android splash** — all 11 `drawable*/splash.png` at their scaffolded dimensions.

Re-run it after changing `source.png`. `npx cap sync` does **not** touch these.

### Store compliance built into the projects

- **Privacy manifest** — [ios/App/App/PrivacyInfo.xcprivacy](ios/App/App/PrivacyInfo.xcprivacy), wired into the Xcode target's Resources phase so it lands at the bundle root. Without it, uploads bounce with ITMS-91053. It declares the two required-reason APIs the Capacitor runtime touches (UserDefaults `CA92.1`, file timestamps `C617.1`) and no data collection. If a future plugin touches another required-reason API, add it here or the next upload fails.
- **Export compliance** — `ITSAppUsesNonExemptEncryption = false` in `Info.plist`. Without it every App Store Connect build parks in "Missing Compliance" and never reaches TestFlight testers until someone answers the question by hand.
- **Orientation** — both shells are landscape-locked: `UISupportedInterfaceOrientations` (plus `UIRequiresFullScreen`, which is what makes the lock stick on iPad) and `android:screenOrientation="sensorLandscape"`. The web build can only *ask* the player to rotate (`src/ui/LandscapeNudge.tsx`); the native shells enforce it.
- **Data safety / privacy labels** — declare "no data collected" for both stores. That is true only because the Plausible loader in `src/analytics.ts` refuses to run unless the hostname matches `VITE_PLAUSIBLE_DOMAIN`, which never holds inside a WebView. If analytics ever ships in the native shells, both stores' declarations and the privacy manifest have to change with it.

### Store listing screenshots

Both consoles reject screenshots that miss their exact pixel sizes, so the listing images are generated rather than cropped by hand:

```bash
pnpm screenshots:store:list   # print the size table and per-set counts, capture nothing
pnpm screenshots:store        # capture everything
```

Raw output lands in `store-screenshots/` at the repo root — **gitignored on purpose**. Review native-device fidelity, then archive selected captures under `docs/store-assets/` and add them to its catalog. The committed [store asset library](docs/store-assets/README.md) owns approved upload snapshots, provenance and the reusable assembly workflow. It is 29 MB of regenerable binaries, and anything under `public/` would be copied into `dist/` and from there into the shipped Capacitor and Tauri bundles. These are console upload artifacts; they must not travel inside the app.

Sets produced (all landscape, all alpha flattened onto `#0b1016` — both stores reject alpha):

| Set | Size | Count accepted |
| --- | --- | --- |
| App Store — 6.9" iPhone | 2868×1320 | 1–10 |
| App Store — 13" iPad | 2752×2064 | 1–10 (required: the target is iPhone + iPad) |
| Play — phone | 1920×1080 | 2–8 |
| Play — 7" tablet | 1920×1080 | 4–8 |
| Play — 10" tablet | 2560×1440 | 4–8 |
| Play — feature graphic | 1024×500 | exactly 1 |

Six scenes are captured per gameplay set, which sits inside every min/max. Each aspect ratio is rendered natively rather than cropped from one master, because the HUD is responsive — a 4:3 iPad shot cropped out of a 16:9 frame would show a layout no iPad ever displays.

The size table lives in `STORE_TARGETS` in [scripts/store-screenshots.mjs](scripts/store-screenshots.mjs); update it there when Apple or Google change requirements. The scene drivers are shared with the marketing capture via [scripts/lib/capture-scenes.mjs](scripts/lib/capture-scenes.mjs).

The capture drives `?capture=1`, which is gated on `import.meta.env.DEV` — so it needs a dev server, not `vite preview` against a production `dist/`.

### Console declarations — the answers that depend on code

The full submission walkthrough (form-by-form, with wait times) lives in the vault as `mesozoic-protocol-store-submission-checklist.md`. What belongs *here* is the set of console answers that are only true because of how the code is built — change the code and these become false declarations, not just stale notes.

| Declaration | Answer | What makes it true |
| --- | --- | --- |
| Apple App Privacy | **No data collected** | Nothing leaves the device. Apple's definition: *"Data that is processed only on device is not 'collected'."* localStorage, Capacitor Preferences, and a WebView rendering bundled assets are all outside it. |
| Play Data safety | **No data collected** | Same. Mandatory to fill in even at zero collection. |
| Apple age rating: **Unrestricted Web Access** | **No** | The WebView loads only bundled assets and `capacitor.config.ts` sets no `server.allowNavigation`. Answering Yes forces a 16+ rating. **Add an allowNavigation entry and this answer becomes a lie.** |
| Play: Advertising ID | **Not used** | No dependency declares `com.google.android.gms.permission.AD_ID`. Re-check the *merged* manifest after adding any Capacitor plugin — a transitive dep injecting it contradicts "no data collected". |
| Apple export compliance | Exempt | `ITSAppUsesNonExemptEncryption = false` in `Info.plist`. Only true while no dependency ships its own crypto. This is a regulatory statement, not a UI shortcut — re-audit per release. |
| Apple review notes | "runs entirely offline, no network activity" | Requires zero runtime requests to any external host. Verify with a proxy in airplane mode before each submission. |
| Play target API level | 36 | `android/variables.gradle`. API 36 became mandatory for new apps and updates on **2026-08-31**. |

Two rating answers are judgment calls rather than code facts, recorded here so they stay consistent across releases: Apple **13+** (frequent cartoon/fantasy violence, frequent weapons — under-declaring to reach 9+ is a common rejection and Apple can re-rate unilaterally), and Play target audience **13+ and up only** (selecting any band under 13 triggers Google Play's Families Policy and a separate, heavier review).

### Save data on native

`localStorage` inside a WKWebView is evictable cache: iOS can clear it under disk pressure or when the app is offloaded, and the player loses their campaign without ever uninstalling.

[src/nativeSaveBackup.ts](src/nativeSaveBackup.ts) mirrors the `mesozoic-protocol:` keys (save slots, progress, language, audio, fullscreen preference) into `@capacitor/preferences` — NSUserDefaults / SharedPreferences, which is durable app data — and restores from that mirror at boot whenever localStorage came up empty. Existing local values always win, so a stale snapshot can never overwrite a live save. The editor's `mz:` keys are authoring scratch and deliberately not mirrored.

The restore has to happen before anything reads storage, which is why [src/main.tsx](src/main.tsx) defers the `App` and `i18n` imports behind it — both read at module-evaluation time. Off-native every entry point no-ops.

Android backup is scoped to match: [backup_rules.xml](android/app/src/main/res/xml/backup_rules.xml) and [data_extraction_rules.xml](android/app/src/main/res/xml/data_extraction_rules.xml) include the WebView storage directory and shared prefs, and exclude caches — so a device transfer carries the campaign across but not GPU cache churn.

### Other mobile notes

- Plausible analytics defaults to `play.mesozoicprotocol.com` and the self-hosted script at `https://plausible.trebeljahr.com`. The loader and event wrapper both require the current hostname to match `VITE_PLAUSIBLE_DOMAIN`, so local previews and mobile/native shells stay silent.
- Android manifest (`android/app/src/main/AndroidManifest.xml`) already has `INTERNET` permission for analytics. Add no others unless required by future plugins.

## Signed candidates for all platforms

Run **Signed release candidate** on `main` to build one commit for macOS
(Intel and Apple Silicon), Windows x64, Linux x64, Android, and iOS:

```bash
gh workflow run release-candidate.yml --ref main -R trebeljahr/mesozoic-protocol
```

The workflow reuses the platform builders and disables mobile store uploads.
It does not create a tag, publish a release, or upload to Steam or itch.io.
Every platform must succeed before the combined `signed-candidate-<commit>`
artifact is uploaded. It contains the signed/notarized macOS DMG and app
archive, signed Windows MSI and EXE, Linux AppImage and DEB, signed Android
APK and AAB, and Apple Distribution signed IPA. The IPA requires TestFlight
or App Store distribution; it is not an unrestricted sideload build. The APK
uses the upload certificate, so it does not replace a Play-installed copy
when Play App Signing uses a different certificate.

`candidate.json` records the commit, run, file hashes, and signing types.
`SHA256SUMS.txt` checks download integrity. GitHub's signed provenance binds
each payload and manifest to this workflow and commit, including Linux
packages, which do not use Apple or Windows code-signing identities:

```bash
gh run download RUN_ID -R trebeljahr/mesozoic-protocol -n signed-candidate-COMMIT
shasum -a 256 -c SHA256SUMS.txt
gh attestation verify FILE -R trebeljahr/mesozoic-protocol \
  --signer-workflow trebeljahr/mesozoic-protocol/.github/workflows/release-candidate.yml
```

After downloading a Linux AppImage, run `chmod +x FILE.AppImage`; Actions archives do not preserve executable permissions.

Artifacts are retained for 90 days. Keep downloaded copies separately, or
publish a reviewed release for permanent downloads. The `.signing/` folder
contains private material and must never be included with candidate files.
Updater signatures are required once a real updater public key is committed;
before that setup is approved, native signatures and provenance still apply.

## Releasing

One tag fans out to every platform. The whole release is three commands:

```bash
node scripts/sync-version.mjs 0.2.0     # writes all five version declarations
git commit -am "release: v0.2.0"
git tag v0.2.0 && git push origin v0.2.0
```

`sync-version.mjs` replaces the old "bump it in package.json and
tauri.conf.json and hope" step — see [Versioning](#versioning). iOS
`CFBundleVersion` and Android `versionCode` include the run number and attempt,
and Android's `versionName` comes from the synchronized package version.

The tag triggers, in parallel:

| Workflow | Produces |
| --- | --- |
| [build-macos.yml](.github/workflows/build-macos.yml) | universal `.app`/`.dmg`, Developer ID signed, notarized, stapled |
| [build-windows.yml](.github/workflows/build-windows.yml) | `.msi` + `-setup.exe`, Azure Trusted Signing; plus the unpacked `.exe` for Steam |
| [build-linux.yml](.github/workflows/build-linux.yml) | AppImage + `.deb`; plus the unpacked binary for Steam. No signing |
| [build-ios.yml](.github/workflows/build-ios.yml) | archives and uploads to TestFlight |
| [build-android.yml](.github/workflows/build-android.yml) | signs the AAB and uploads to the Play internal track |
| [ci.yml](.github/workflows/ci.yml) | lint + typecheck + version check + web build |

and then, waiting on the desktop three:

| Workflow | Does |
| --- | --- |
| [release.yml](.github/workflows/release.yml) | publishes a GitHub Release with the installers, then pushes to itch.io |
| [steam.yml](.github/workflows/steam.yml) | uploads the three Steam depots (soft-skips until Steamworks is configured) |

Every workflow is also `workflow_dispatch`-able from the Actions tab without
tagging. `release.yml` and `steam.yml` take an existing tag as a dispatch input,
so a failed release can be re-run after fixing the underlying build.

### GitHub Release

Workflow artifacts expire after 90 days and are only visible to people who can
see the Actions tab. [release.yml](.github/workflows/release.yml) turns a tag
into something permanent and public: it waits for `build-macos`,
`build-windows`, and `build-linux` to conclude for that commit, collects the
`.dmg` / `.msi` / `-setup.exe` / `.AppImage` / `.deb`, generates a
`SHA256SUMS.txt`, and publishes them all with `softprops/action-gh-release@v2`
(hence `permissions: contents: write`).

Two deliberate choices:

- **It waits rather than races, and fails loudly rather than partially.** If any
  of the three desktop builds did not succeed, it publishes *nothing* and fails
  with the list of failures. A Release that quietly contains Windows and Linux
  but not macOS looks complete and is not. Fix the build, then re-run
  `release.yml` with the tag as input. The wait is a 90-minute polling loop
  (`scripts/ci/gather-build-artifacts.sh`) — the macOS universal build plus
  notarization is the long pole.
- **It does not wait on iOS or Android.** Their outputs are store submissions,
  not downloadable assets, and an App Review hiccup should not block the desktop
  release. Neither the `.ipa` nor the `.aab` is attached to the Release —
  publishing a store binary nobody can install serves no one.

### itch.io

itch.io takes any binary — no per-store signing variant required. The
Developer ID–signed + notarized DMG, the Azure-signed `.msi`/`-setup.exe`, and
the unsigned Linux bundles all work as-is. Users installing through the itch.io
desktop app additionally get automatic updates.

Automated as the `itch` job in [release.yml](.github/workflows/release.yml). It
installs `butler` and pushes one channel per platform — `osx`, `windows`,
`linux` — each a separate slot in itch.io's "Uploads" tab, versioned with the
tag via `--userversion`. It lives in `release.yml` rather than being repeated in
the three platform workflows because the artifacts are already gathered there:
one butler install, one place to change the channel names.

It **soft-skips with a `::notice::` and exits 0** when not configured, so the
repo stays green before the itch.io project exists. To enable it:

1. Create the project at `<your-user>/mesozoic-protocol` on itch.io (one-time UI step).
2. Get an API key from <https://itch.io/user/settings/api-keys> → repo secret `BUTLER_API_KEY`.
3. Set the repo variable `ITCH_USER` to the account that owns the project.
   (`ITCH_GAME` is an optional repo variable; it defaults to `mesozoic-protocol`.)

### Manual residue

- Promoting from TestFlight to a public App Store release is manual (Apple's review).
- Promoting from the Play internal track to production is manual (or change the workflow's `track` dispatch input).
- Setting an uploaded Steam build live on a branch is manual in the Steamworks dashboard, unless you set the `STEAM_RELEASE_BRANCH` repo variable.
- The one-time vendor setup — Steamworks app + depots, the itch.io project, Apple/Play app records, Azure identity validation — is manual by nature. Each is documented in its section above.

## Auto-update (Tauri updater)

Direct downloads — the DMG, the `-setup.exe`, the AppImage — have no update
path of their own. Steam and the itch.io app update their own copies; a GitHub
Release does not. [tauri-plugin-updater](https://v2.tauri.app/plugin/updater/)
closes that gap: the app asks a signed JSON manifest whether a newer version
exists, and installs it in place.

The updater public key and its two GitHub Actions secrets are configured.
Desktop CI builds the updater and signs its payloads. Updates become available
when a newer reviewed GitHub Release publishes a complete `latest.json` and
its payloads; a candidate build alone does not offer an update to installed users.

### The activation gate

`bundle.createUpdaterArtifacts` is deliberately *not* in
[src-tauri/tauri.conf.json](src-tauri/tauri.conf.json). With it set there,
`tauri build` fails outright whenever `TAURI_SIGNING_PRIVATE_KEY` is unset,
which would turn every current CI run red months before the key exists.

Instead the updater config lives in a separate overlay,
[src-tauri/tauri.updater.conf.json](src-tauri/tauri.updater.conf.json), holding
only `bundle.createUpdaterArtifacts` and the `plugins.updater` block
(`pubkey`, `endpoints`, `windows.installMode`). The three desktop workflows
merge it in with `tauri build --config …` — Tauri applies extra `--config`
files as an [RFC 7396](https://datatracker.ietf.org/doc/html/rfc7396) merge
patch, so it adds those two keys and leaves the rest of `bundle` (icons,
signing command, NSIS settings) untouched.

[scripts/ci/updater-gate.sh](scripts/ci/updater-gate.sh) decides, per build,
whether to pass that flag. It requires **both**:

- the `TAURI_SIGNING_PRIVATE_KEY` secret to be set, and
- the overlay's `pubkey` to no longer be the shipped placeholder.

Desktop CI uses `REQUIRE_UPDATER=auto`: the placeholder public key permits
the initial setup state, but after a real key is committed, a missing private
key fails the build. `REQUIRE_UPDATER=true` also rejects the placeholder;
local use without this flag may omit the updater. When both keys are present
the gate emits `--config src-tauri/tauri.updater.conf.json
--features updater`, so the compiled code and the config can never disagree:
one gate turns on both. It also fails loudly if the overlay carries a real
pubkey but no endpoints, or if a `github.com` endpoint names a different
repository than the one publishing the release.

### One-time activation

1. Generate the keypair. It never leaves your machine and never enters the repo:

   ```bash
   pnpm tauri signer generate -w ~/.tauri/mesozoic-protocol.key
   ```

   That writes `~/.tauri/mesozoic-protocol.key` (private, password-protected)
   and `~/.tauri/mesozoic-protocol.key.pub` (public). Give it a password —
   Tauri prompts for one, and CI passes it through as a secret.

2. **Back the private key up off-machine, exactly like the Android upload
   keystore.** Losing it is unrecoverable in a specific and permanent way:
   every already-installed copy of the game only trusts updates signed by that
   key. A new key cannot sign for the old one, so every existing install is
   orphaned — those players never see another update and have to download and
   install a fresh build by hand. There is no revocation, no override, no
   support channel to appeal to. Treat it like the keystore: a password manager
   attachment plus one offline copy.

3. Add two repository secrets under **Settings → Secrets and variables →
   Actions**:

   | Secret | Value |
   | --- | --- |
   | `TAURI_SIGNING_PRIVATE_KEY` | the entire contents of `~/.tauri/mesozoic-protocol.key` |
   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password you set in step 1 |

   Both names are read directly by Tauri from the process environment; they are
   not configurable.

4. Paste the public key into
   [src-tauri/tauri.updater.conf.json](src-tauri/tauri.updater.conf.json),
   replacing `REPLACE_ME_RUN_TAURI_SIGNER_GENERATE`:

   ```bash
   cat ~/.tauri/mesozoic-protocol.key.pub
   ```

   While you are in that file, confirm `plugins.updater.endpoints` points at
   the repository that actually publishes the releases. The gate script
   cross-checks it against `GITHUB_REPOSITORY` and fails the build on a
   mismatch, but only once the updater is live.

5. Commit and tag as usual. The first tagged release built with the key is the
   one that starts publishing `latest.json`; its installers are the first ones
   that can self-update. Copies installed before that point have no updater
   compiled in and never will — they are a manual-reinstall cohort.

### How an update is found and applied

`plugins.updater.endpoints` points at

```
https://github.com/<owner>/<repo>/releases/latest/download/latest.json
```

`/releases/latest/` resolves to the newest release **that is not marked as a
prerelease**, so tagging a beta as a prerelease keeps it out of every player's
updater automatically. (`release.yml` currently publishes with
`prerelease: false`; flip that input when you want a build that is downloadable
but not offered as an update.)

[scripts/ci/make-updater-manifest.mjs](scripts/ci/make-updater-manifest.mjs)
generates `latest.json` in `release.yml` from the `.sig` files the platform
builds produced, and attaches it to the Release alongside the installers. It is
dependency-free Node and runnable by hand:

```bash
node scripts/ci/make-updater-manifest.mjs \
  --artifacts <dir-of-gathered-build-artifacts> \
  --tag v0.2.0 --repo <owner>/<repo> --out latest.json
```

Four details in that script are load-bearing:

- **`signature` is the contents of the `.sig` file, not a path to it.** The
  `.sig` files themselves are not attached to the Release; they only exist to
  be inlined here.
- **Tauri validates every platform entry before it compares versions.** One
  malformed entry breaks updates for every platform, not just its own — so the
  script emits a platform only when it has both the payload and its signature,
  and fails the release outright rather than publishing a half manifest.
- **There is no `darwin-universal` key.** The macOS build is a universal
  binary, so the same `.app.tar.gz` is listed under both `darwin-x86_64` and
  `darwin-aarch64`; the running app picks the key matching its own arch.
- **Windows updates from the NSIS `-setup.exe`, not the `.msi`.** The MSI stays
  in the Release for policy deployment, but the NSIS installer's
  `installMode: "passive"` handles the unattended in-place upgrade on its own,
  where the MSI path would need elevation prompts and msiexec argument
  juggling. It is a download, not an update channel.

GitHub rewrites release asset names (spaces become dots), so the URLs in
`latest.json` are predicted rather than observed. `release.yml` therefore runs
`make-updater-manifest.mjs --verify` against the published Release and fails if
any URL does not resolve — a manifest full of 404s is otherwise invisible until
players quietly stop receiving updates.

The updater signature is generated over the *already code-signed* artifact on
both platforms that have one: the notarized+stapled macOS `.app` and the
Trusted-Signing-signed NSIS installer. An installed update passes Gatekeeper
and SmartScreen exactly like a fresh download does.

### Steam and the itch.io app do not self-update

A Tauri update overwrites files SteamPipe owns. The next "Verify integrity of
game files" silently reverts it, and the `perMachine` NSIS installer would land
a second copy next to Steam's. Two layers keep that from happening:

- **Compile time** — the plugin sits behind the `updater` Cargo feature, which
  is opt-in and not in `default`. A build that forgets the flag ships with no
  self-update machinery at all. The inverse default (a `steam` feature that
  *disables* it) would mean every build that forgets a flag ships a
  self-updater, including the depot; this direction fails safe.
- **Run time** — [src-tauri/src/updater.rs](src-tauri/src/updater.rs) refuses to
  register the plugin when it sees `SteamAppId` / `SteamGameId` /
  `SteamOverlayGameId` / `SteamClientLaunch` in the environment, a
  `steam_appid.txt` next to the executable, or a `steamapps` path segment.

The runtime layer is the one that actually applies today, and it is not
decorative. `steam.yml` does not build anything: it reuses the `*-portable`
artifacts from the very same `tauri build` runs that produce the installers, so
the depot binary *is* the installer binary and the compile-time feature cannot
tell them apart. Splitting them would mean a second full Rust build (plus a
second notarization on macOS) per release. If that trade ever becomes worth it,
the change is a separate no-feature build step feeding a `*-portable-steam`
artifact.

`steam.yml` also asserts that no installer or updater artifact leaked into a
depot, and `release.yml` strips `.sig` / `.app.tar.gz` before handing the
artifacts to butler — the itch.io app runs its own differential updates and has
no use for the Tauri payload.

### Durable saves before installation

Updates use three native commands: check, download, and install. Download
verifies the updater signature and retains the payload in memory. Before
installation, the frontend pauses the mission, blocks input, snapshots the
active slot, and awaits the native save-file write. A failed save prevents
installation; retry can reuse the verified download. This also protects the
Windows path, where the installer terminates the process without a normal close.

The desktop save backend writes `progress.json` and `progress.backup.json`
under the application data directory. Writes use a temporary file, flush it,
and atomically replace the destination. The backup retains the previous valid
document. An OS file lock prevents two game instances from writing the same
profile. Unexpected external changes block further writes until restart.

Startup loads disk files before importing the game store. A valid disk document
replaces campaign entries in the WebView cache, including deletions. Standalone
builds migrate old WebView saves on first use; Steam profiles require explicit
import of standalone saves, preventing account switching from copying another
player's progress. If both disk copies are unreadable, startup shows recovery
controls and leaves the files untouched. A normal window close or macOS Quit
waits for pending writes; failed writes keep the game open with a retry notice.

The app commands are registered together with the optional updater so save
support works with or without the updater feature. The web and Capacitor builds
retain their existing persistence paths.

### The update prompt

[src/ui/UpdateNotice.tsx](src/ui/UpdateNotice.tsx) is a small corner card built
from the existing `overlay-card` / `btn` classes. It is mounted next to
`AchievementToast` in [src/App.tsx](src/App.tsx) — deliberately *not* in the
splash/slot early returns, so the check cannot start until the player is past
the entry flow. On top of that it waits 12 s and then asks for an idle
callback, so the network round trip and signature parse never contend with
shader compilation or model loading. One check per app run.

On the web build and inside the Capacitor shells the Tauri globals do not
exist, `src/updater.ts` short-circuits before the dynamic `@tauri-apps/api`
import, and the component renders nothing. The bindings are their own Vite
chunk (`tauri`), so a browser visitor never downloads them.

### Testing it before a real release

`pnpm tauri build --config src-tauri/tauri.updater.conf.json --features updater`
reproduces exactly what CI does once activated, and needs
`TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` exported in
the shell. To exercise the full loop, point `plugins.updater.endpoints` at a
local file server serving a hand-written `latest.json`, install a build with a
lower version, and run it.

One gotcha worth knowing: the Tauri CLI refuses to build when the
`@tauri-apps/api` npm package and the `tauri` Rust crate are on different
minor versions. `src-tauri/Cargo.lock` is the source of truth — if a `cargo
update` moves the crate, bump the npm package to match in the same commit.
