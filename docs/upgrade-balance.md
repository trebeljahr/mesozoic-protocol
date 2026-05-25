# Upgrade Balance Notes

Manual note 15, item 14: tower-spam traces had too many copies of the same cheap
base tower and too few "save, buy the big thing, feel strong" moments.

## Brainstormed levers

- Script realism: give `wave-optimal-path` finite placement slots instead of
  unlimited copies per lane-coverage class. This would make traces less spammy,
  but would not change live play by itself.
- Wave authoring: add more small shield / regen / resist-chip sub-packs that
  are explicitly cracked by tier-3 anti-modifier upgrades.
- Economy: raise repeat-build costs for duplicate towers. Strong, but it needs
  live UI support so the player sees the price before committing.
- Upgrade curve: keep early towers cheap, lower the all-purpose power of base
  Chain Coil, and make final-tier upgrades outclass another base tower when the
  right wave appears.

## Implemented pass

This pass uses the economy and upgrade-curve levers:

- Same-kind builds are flat-cost (no escalating surcharge) but hard-capped at
  `TOWER_BUILD_LIMIT` (8) copies per kind in a run. Caps mono-spam and forces
  loadout breadth without taxing the early-game first copies the wave economy is
  tuned around; past the cap, gold flows into upgrades or other kinds.
- Chain Coil base bounce count drops to 4 nearby targets after the primary
  target, down from 7. Spam still works as a lesson tool but no longer covers
  every swarm role cheaply.
- Chain path A now climbs back into the old swarm role and then overshoots it:
  bigger bounce gains, better falloff, fire-rate scaling, and a no-falloff
  Storm tier with a large fire-rate spike.
- Pulse, Mortar, Cryo, and Pyre tier-3 upgrades get stronger spike values so
  the expensive last purchase is meaningfully more gold-efficient in the wave
  types it is meant to counter.

Follow-up candidates if spam returns:

- Add finite placement-capacity modeling to `wave-optimal-path`.
- Add one late "modifier check" wave per biome that clearly rewards one
  specific tier-3 counter.
- Surface trace suggestions in debug as "save for this upgrade by Wn" prompts.
