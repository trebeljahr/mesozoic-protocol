# Distribution

How to ship Mesozoic Protocol to desktop (Tauri / Steam) and mobile (Capacitor / iOS / Android).

The web build is a static Vite bundle in `dist/`. Both shells just wrap that bundle:

- Tauri loads `dist/` inside a native WebView (Wry on macOS/Windows/Linux).
- Capacitor loads `dist/` inside iOS WKWebView or Android WebView.

So `pnpm build` always runs first; both shells then sync the result.

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

Tauri bundles per host. To produce both macOS and Windows artifacts:

- Run `pnpm tauri build` on a Mac for `.app`/`.dmg`.
- Run `pnpm tauri build` on Windows (or a Windows VM / GitHub Actions runner) for `.msi`/`.exe`.

For CI, use the official `tauri-action`: <https://github.com/tauri-apps/tauri-action>.

### Code signing — Windows via Azure Trusted Signing

Steam distributes through its own DRM and doesn't require notarization, but unsigned binaries trigger Gatekeeper / SmartScreen warnings if a user runs the bundle outside Steam.

Windows signing is wired through **Azure Trusted Signing** — Microsoft's managed signing service that replaces EV USB tokens. Cert lives in Azure, `signtool.exe` calls the Trusted Signing dlib with a service-principal token. CI runs in [.github/workflows/build-windows.yml](.github/workflows/build-windows.yml).

**Eligibility & cost:** Trusted Signing requires verifiable business (3+ years for Public Trust certs that dismiss SmartScreen on first run) or individual validation. ~$9.99/month + per-signature fees on volume tier. Under-3-year orgs get Private Trust profiles only — those still sign, but don't bypass SmartScreen.

**One-time Azure setup:**

1. Azure Portal → create `Microsoft.CodeSigning/codeSigningAccounts` resource. Pick region near CI runners (e.g. `westus2`).
2. Submit **Identity Validation** (LLC docs, EIN, address proof for business; gov ID for individual). Approval: hours to days.
3. Create a **Certificate Profile** — `Public Trust` if eligible, else `Private Trust`. Subject CN = `Ricos Labs LLC`. Note the profile name + endpoint URL (`https://<region>.codesigning.azure.net`).
4. Create a service principal for CI:
   ```bash
   az ad sp create-for-rbac --name "mesozoic-trusted-signing" --skip-assignment
   az role assignment create \
     --assignee <APP_ID> \
     --role "Trusted Signing Certificate Profile Signer" \
     --scope "/subscriptions/<SUB>/resourceGroups/<RG>/providers/Microsoft.CodeSigning/codeSigningAccounts/<ACCOUNT>"
   ```

**Tauri integration:** `src-tauri/tauri.conf.json` sets `bundle.windows.signCommand` to invoke `signtool` with `/dlib` pointing at the Trusted Signing client DLL and `/dmdf` at a JSON metadata file. CI installs the dlib via NuGet (`Microsoft.Trusted.Signing.Client`) and writes the metadata file at runtime.

**Required GitHub secrets:** `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TS_ACCOUNT`, `AZURE_TS_PROFILE`, `AZURE_TS_ENDPOINT`. (Upgrade to OIDC later by configuring a federated identity credential on the Azure AD app and dropping the client secret.)

**Local signing:** install the Windows SDK signtool (10.0.22621+) and the Trusted Signing client; export the same env vars; then `pnpm tauri build` signs as a side effect. To smoke-test signtool alone:

```powershell
signtool sign /v /debug /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 `
  /dlib "C:\path\to\Azure.CodeSigning.Dlib.dll" `
  /dmdf "C:\path\to\metadata.json" `
  "path\to\some.exe"
signtool verify /pa /v "path\to\some.exe"
```

### Code signing — macOS (manual for now)

macOS Tauri signing is not yet automated. For Steam-only distribution it's optional. For a notarized .dmg outside Steam: Apple Developer ID Application cert, `APPLE_ID` + `APPLE_PASSWORD` (app-specific) + `APPLE_TEAM_ID` env vars, then `pnpm tauri build` notarizes automatically. See <https://tauri.app/distribute/sign/macos/>.

### Steam upload

1. Get a Steam Direct app from <https://partner.steamgames.com> (one-time fee per app).
2. Install Steamworks SDK + `steamcmd`: <https://partner.steamgames.com/doc/sdk>.
3. Configure a depot per platform (macOS / Windows / Linux).
4. Build, then point your depot's `ContentRoot` at the platform-specific output:
   - macOS depot → `src-tauri/target/release/bundle/macos/Mesozoic Protocol.app/`
   - Windows depot → directory containing `mesozoic-protocol.exe` and any sibling DLLs/resources Tauri produced
   - Linux depot → AppImage or extracted runtime
5. Run `steamcmd +run_app_build <path-to-app_build_<appid>.vdf>` to upload.
6. Set the build live in the Steamworks dashboard.

### Optional: Steamworks SDK (achievements, overlay, cloud saves)

The current build is **Steam-shippable as-is** — Steam wraps any plain executable. To get achievements, the Steam overlay, friends list, or cloud saves you'd add the SDK. This is optional and requires a real Steam App ID. Sketch:

1. Add `steamworks = "0.11"` to `src-tauri/Cargo.toml` and download the proprietary SDK (`STEAM_SDK_LOCATION` env var).
2. In `src-tauri/src/lib.rs`, init `steamworks::Client::init_app(<APP_ID>)` in the Tauri `setup` hook and expose Tauri commands for achievement / cloud-save calls.
3. Add a `steam_appid.txt` (single line: the app ID) next to the executable so the SDK can attach when you launch outside Steam during dev. **Do not commit this file** — add it to `src-tauri/.gitignore`.
4. From the renderer, invoke commands via `@tauri-apps/api`'s `invoke()`. Map game events (level cleared, achievement earned, save-slot updated) to Steamworks calls.

Until then, the game saves locally via the existing Zustand persistence layer and posts no telemetry to Steam — fine for soft launch.

## Mobile (Capacitor → iOS / Android)

Capacitor bundles the Vite build inside a native shell. No RN rewrite, no Expo. The web app already handles touch input, fullscreen, landscape detection, and responsive panels (see notes items 10, 11, 13).

### One-time prerequisites

- iOS: Xcode 15+, an Apple Developer account ($99/yr) for App Store distribution. CocoaPods is **not** required — Capacitor 8 uses Swift Package Manager.
- Android: JDK 17+ and Android Studio (or just the Android SDK + `gradle`). Set `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) to the SDK directory.

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

Bundle ID is `com.mesozoicprotocol.app` (matches the Tauri identifier — keep them in sync).

Automated in [.github/workflows/build-ios.yml](.github/workflows/build-ios.yml). Flow: build web bundle → `npx cap sync ios` → import distribution cert into a temp keychain → install provisioning profile → render `ExportOptions.plist` from [scripts/ios-ExportOptions.plist.template](scripts/ios-ExportOptions.plist.template) → `xcodebuild archive` → `xcodebuild -exportArchive` → upload .ipa to TestFlight via the App Store Connect API.

**One-time Apple setup:**

1. **Apple Developer Portal → Certificates** → create `Apple Distribution` certificate, download, import to Keychain, then export as `.p12` with a password (right-click the cert in Keychain Access → Export).
2. **Identifiers** → register `com.mesozoicprotocol.app` (Capabilities: Push if needed; default otherwise).
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

`CFBundleVersion` is auto-bumped from `GITHUB_RUN_NUMBER` so every TestFlight upload has a fresh build number. `MARKETING_VERSION` (the visible version) stays controlled by the tag / pbxproj.

**Local fallback:** Xcode → set Team, Product → Archive → Distribute App → App Store Connect.

### Android distribution — Play Console via CI

Automated in [.github/workflows/build-android.yml](.github/workflows/build-android.yml). Flow: build web bundle → `npx cap sync android` → decode keystore from secrets → write `android/keystore.properties` → `./gradlew bundleRelease` → upload signed `.aab` to the Play Console internal track.

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
3. **Play Console** → create app, link package `com.mesozoicprotocol.app`, configure the internal testing track.
4. **Play Console → Setup → API access** → link a Google Cloud project → create a service account → grant it `Release manager` (or narrower: `Release apps to testing tracks`). Download the service account JSON.
5. **First release must be uploaded manually through the Play Console UI** so Google can validate the app and distribution terms can be accepted. Subsequent versions can flow through this workflow.

**Required GitHub secrets:** `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON`.

`versionCode` is auto-bumped from `GITHUB_RUN_NUMBER` (Play Console requires monotonically increasing integers). `versionName` comes from the git tag (e.g. `v0.2.0`) or falls back to `0.0.<run>` on manual dispatch. Both are read by [android/app/build.gradle](android/app/build.gradle) from env vars.

**Local fallback:** drop a `mesozoic-protocol.keystore` + `keystore.properties` in `android/` (see workflow for format), then `cd android && ./gradlew bundleRelease`. Or use Android Studio: Build → Generate Signed Bundle / APK.

### Mobile-specific notes

- The web build uses `localStorage` for save data; that survives WebView reloads but **not** OS-level uninstall on iOS (iOS clears WebView storage on reinstall). If save persistence across reinstalls matters, swap to `@capacitor/preferences` and adapt the `progress.ts` / save-slot layer.
- Plausible analytics defaults to `protocol.trebeljahr.com` and the self-hosted script at `https://plausible.trebeljahr.com`. The loader and event wrapper both require the current hostname to match `VITE_PLAUSIBLE_DOMAIN`, so local previews and mobile/native shells stay silent.
- iOS Info.plist (`ios/App/App/Info.plist`) supports portrait + both landscapes by default. Edit `UISupportedInterfaceOrientations` to landscape-only if desired.
- Android manifest (`android/app/src/main/AndroidManifest.xml`) already has `INTERNET` permission for analytics. Add no others unless required by future plugins.

### Updating the app — automated

For Windows, iOS, and Android, push a `v<semver>` tag and the three workflows fan out:

```bash
# 1. Bump version in package.json + src-tauri/tauri.conf.json.
#    (iOS CFBundleVersion and Android versionCode auto-bump from run number;
#     MARKETING_VERSION / versionName come from the tag.)
git commit -am "release: v0.2.0"
git tag v0.2.0
git push origin v0.2.0
```

That triggers:

- [.github/workflows/build-windows.yml](.github/workflows/build-windows.yml) — signs MSI + setup.exe with Azure Trusted Signing, artifacts uploaded.
- [.github/workflows/build-ios.yml](.github/workflows/build-ios.yml) — archives and uploads to TestFlight (App Store Connect API).
- [.github/workflows/build-android.yml](.github/workflows/build-android.yml) — signs AAB and uploads to Play Console internal track.

Each workflow is also `workflow_dispatch`-able from the Actions tab without tagging (useful for testing).

Manual residue:

- Steam upload still goes through `steamcmd` (see above).
- macOS Tauri build is not yet automated.
- Promoting from TestFlight to public App Store release is manual (Apple's review).
- Promoting from Play internal track to production is manual (or change the workflow `track` input).
