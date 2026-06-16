# Press / marketing screenshots

Gameplay captures across biomes and pilots, generated headlessly — no manual
play required.

## Regenerate

With a dev server running (note its port):

```sh
pnpm dev                     # terminal 1
BASE_URL=http://localhost:5173 node scripts/capture-screenshots.mjs   # terminal 2
```

The script (`scripts/capture-screenshots.mjs`) drives the real game in headless
Chromium via the `?capture=1` flag (see `src/debug.ts`): it unlocks progress,
enters a level with a chosen pilot, lines the path with towers, forces a late
wave, drives the pilot into the fight and fires its ultimate, then screenshots.

Edit the `SCENARIOS` array to change levels, pilots, or tower loadouts.

## Files

Full-res PNG masters (3840×2160) are git-ignored; the committed `.jpg` files
are 1920-wide, quality 85 — small enough for web/press use. Regenerate the PNGs
with the script, then `sips -s format jpeg -s formatOptions 85 -Z 1920 in.png --out out.jpg`.
