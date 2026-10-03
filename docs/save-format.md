# Save transactions and mission checkpoints

Each `mesozoic-protocol:slot:<id>:v1` value is one JSON transaction containing
`meta`, normalized campaign `progress`, and an optional versioned `checkpoint`.
The checkpoint contains the complete simulation world, including tower stats,
upgrades, targeting, drone links, HQ upgrades, robot loadout/cooldowns, removed
scenery, economy, difficulty/mode, and Endless seed/adaptation state.

Checkpoints are captured only when no enemies, queued spawns, boss trickles,
or projectiles remain and the wave is inactive. Quiet periods update at most
once per simulation second; manual wave calls capture immediately beforehand.
Overlapping waves can share an older checkpoint. Restored worlds are paused.
The pause menu and slot screen explain this policy.

During a mission, permanent progress remains live in memory but is persisted
only together with a checkpoint, or together with checkpoint removal on
completion, restart, or abandonment. Thus reload restores both sides of the
same reward transaction. This includes XP, bolts, achievements, encounter and
easter-egg flags. Terminal failure/abandonment still banks that run's rewards.
Suspending during combat replays changes after the latest checkpoint.

`missionPersistence.ts` owns the session-to-slot association. Detaching a
session on slot switching prevents its world from saving again. Import,
recovery, and deletion invalidate prior sessions. Deletion writes a tombstone
so stale legacy keys and native mirror entries cannot resurrect that slot.

## Training integration

Call `excludeWorldFromPersistence(trainingWorld)` from
`src/persistence/missionCheckpoint.ts` **before** installing the training world
or calling `beginMission`. `canPersistWorld` is the common checkpoint and
store-progress gate; it also rejects `world.sessionKind === "tutorial"` without
WeakSet registration. The schema accepts legacy checkpoints without this
optional field, while checkpoint import/restore rejects tagged training worlds.
Training must use its own world/progress and restore the
previous state when it ends. Do not create training through the normal
`startLevel` action: that action starts a real saved mission. An excluded world
cannot create, update, or finish a slot's mission. It never replaces a
suspended real checkpoint.

## Recovery and transfer

Every normal write first stores and verifies the preceding valid transaction
at `<slot-key>:backup`, then writes and reads back the new primary value.
Failures retain a persistent retry action. Corrupt and unsupported slots stay
occupied; automatic writes cannot overwrite them. Explicit recovery archives
the damaged bytes at `<slot-key>:recovered:<timestamp>` before replacing them.
Backup recovery discards the backup's checkpoint, because that mission might
have finished or been abandoned after the backup was made.

Exports contain the selected slot in a `mesozoic-protocol-save`, version `1`
envelope. Import validates the progress and full checkpoint schema before
asking for a destination-specific confirmation. Occupied destinations require
explicit overwrite. Corrupt exports preserve the original bytes for recovery.

The Capacitor Preferences mirror remains active for the whole new namespace.
Native mirror failures use the same warning/retry surface. New local values,
including deletion tombstones, take precedence over native mirror data.

Old `extinction-protocol:` save and audio keys migrate on the **same origin**.
Existing new keys win. Old keys are removed only after a verified copy;
shadowed or unreadable legacy data is retained. Existing progress-version and
audio-version migrations still run after prefix migration. This mechanism
does not transfer data between web origins; export/import provides that path.

## Schema maintenance

`scripts/generate-checkpoint-schema.mjs` parses simulation type declarations
without typechecking or executing the game. After changing persistent World
types, run:

```sh
node scripts/generate-checkpoint-schema.mjs
./node_modules/.bin/biome format --write src/persistence/checkpointSchema.json
```

The generated shape validator checks all required nested fields, unions,
tuples, Maps, and Sets. The codec adds quiet-world and economy invariants and
rebuilds entity lookup maps so they reference the restored entity arrays.
Version the checkpoint format and provide a migration before shipping an
incompatible simulation schema change.
