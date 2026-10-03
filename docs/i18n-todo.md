# Runtime localization maintenance

English and German are the supported runtime languages. `pt-BR` and `zh-CN`
are contributor stubs, checked for key parity but not advertised or bundled
as complete translations.

## Catalogs and consumers

`src/i18n/index.ts` registers `ui`, `enemies`, `towers`, `mechanics`,
`achievements`, `modes`, `lore`, `levels`, `robots`, `skills`, and `upgrades`.
Briefings and level names use `levels`; field-report prose uses `lore`.
Tower upgrade descriptions and robot/meta skills already have catalogs.
Compendium, save slots, field reports, alerts, drone assignment, blockers,
HQ upgrades and planner controls already consume translated copy.

Endless results, renderer recovery, confirmation buttons and remaining
non-debug dismissal/Endless labels now use the UI catalog. These surfaces
must stay translated as new controls are added.

## Rules for new strings

- Add the English key and German translation together. Mirror the key into
  both contributor stubs.
- Preserve established proper nouns: pilot and ability names, tower and
  species names, Mesozoic Protocol and Kairos Corp.
- Translate accessible names and tooltips as well as visible text.
- Run `pnpm check:i18n` (or `node --import tsx scripts/check-i18n.ts` in
  environments that prohibit the CLI IPC socket). Missing/extra keys fail;
  long German labels warn and need a layout check.
- Check narrow landscape and enlarged text. Key parity alone cannot verify
  clipping, accuracy or context.

## Deliberate exceptions

Developer/editor controls and diagnostic exception text remain English.
Static SEO and marketing HTML remain English until per-locale pages exist.
Runtime simulation labels may stay canonical English; UI consumers should
use their catalog equivalents when presenting damage types and descriptions.

This replaces the old extraction backlog, which listed many completed
surfaces as untranslated. Recheck source before creating a localization task.
