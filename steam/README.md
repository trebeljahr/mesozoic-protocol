# Steam setup

Templates and notes for shipping Mesozoic Protocol on Steam. Nothing here is
active until the one-time Steamworks setup below is done —
[.github/workflows/steam.yml](../.github/workflows/steam.yml) soft-skips with a
notice while the App ID and secrets are unset, so the repo stays green.

## Files

| File | Purpose |
| --- | --- |
| `app_build.vdf` | Build-script template for the manual `steamcmd` path. |
| `depot_windows.vdf` | Windows depot template — unpacked `.exe`, not the installer. |
| `depot_macos.vdf` | macOS depot template — the `.app` bundle, not the `.dmg`. |
| `depot_linux.vdf` | Linux depot template — the plain binary, not the AppImage. |

CI does not read these. `steam.yml` uses `game-ci/steam-deploy`, which generates
an equivalent build script from its inputs. The templates are here for uploading
by hand and as the written-down record of your depot IDs.

## One-time Steamworks setup

1. **Buy a Steam Direct app slot** at <https://partner.steamgames.com> (one-time
   fee per app, refundable against revenue). You get a numeric **App ID**.
2. **Create three depots** — Steamworks → your app → SteamPipe → Depots. Add one
   each for Windows, macOS, and Linux, and set each depot's OS in its properties.
   Steamworks numbers new depots `<APP_ID>1`, `<APP_ID>2`, `<APP_ID>3` by default.
3. **Create a dedicated build account.** Do not use your personal Steam account:
   it needs the *Edit App Metadata* / *Publish* permission on this app only, and
   its Steam Guard state lives in a CI secret. Steamworks → Users & Permissions.
4. **Produce `config.vdf`** for that account — this is what lets `steamcmd` log
   in non-interactively past Steam Guard. On a machine with steamcmd installed:

   ```bash
   steamcmd +login <build-account-name> +quit     # enter password + Steam Guard code
   steamcmd +login <build-account-name> +quit     # must now succeed with no prompt
   base64 -i ~/Library/Application\ Support/Steam/config/config.vdf | pbcopy   # macOS
   # Linux: base64 -w0 ~/.steam/steam/config/config.vdf
   ```

   The second login has to succeed silently. If it still prompts, the sentry
   was not persisted and the CI login will fail the same way.

5. **Set the repository variable and secrets** (Settings → Secrets and variables
   → Actions):

   | Name | Kind | Value |
   | --- | --- | --- |
   | `STEAM_APP_ID` | variable | the numeric App ID |
   | `STEAM_USERNAME` | secret | the build account's login name |
   | `STEAM_CONFIG_VDF` | secret | base64 of that account's `config.vdf` |
   | `STEAM_RELEASE_BRANCH` | variable (optional) | beta branch to set live automatically; leave unset to promote by hand |

   Steam Guard sessions expire. When `steam.yml` starts failing on login, redo
   step 4 and replace `STEAM_CONFIG_VDF`.

## Depot IDs

`steam.yml` passes `depot1Path` / `depot2Path` / `depot3Path` to
`game-ci/steam-deploy`, which maps them to depot IDs `<APP_ID>+1`, `<APP_ID>+2`,
`<APP_ID>+3` — matching Steamworks' defaults. If your depot IDs differ (you
deleted and recreated a depot, or the app was set up by someone else), do not
fight the action: fill in the `steam/*.vdf` templates with the real IDs and
upload with `steamcmd +run_app_build` instead.

## Manual upload

```bash
# Assemble ../dist-desktop/{windows,macos,linux} from the platform builds, then:
cp steam/app_build.vdf steam/app_build_<APP_ID>.vdf
# replace every <PLACEHOLDER> in the copy and in the three depot vdf files
steamcmd +login <build-account-name> \
  +run_app_build "$(pwd)/steam/app_build_<APP_ID>.vdf" +quit
```

Set `"preview" "1"` in the build script for a dry run that validates the depot
layout without uploading.

## `steam_appid.txt`

The Steamworks SDK reads `steam_appid.txt` (a single line: the App ID) next to
the executable so it can attach when you launch the game outside Steam during
development. It is **gitignored and must stay that way**, and the depot
templates exclude it explicitly: shipping it makes the retail build ignore the
App ID Steam hands it at launch.

The game does not link the Steamworks SDK today — it ships as a plain
executable, which Steam supports fine. Achievements, the overlay, and Steam
Cloud need the SDK; see the "Optional: Steamworks SDK" section in
[DISTRIBUTION.md](../DISTRIBUTION.md).
