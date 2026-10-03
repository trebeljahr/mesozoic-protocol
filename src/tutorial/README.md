# Interactive training integration

`lessons.ts` owns the core lesson metadata, chapter entry points, board staging,
action evidence and success checks. `advanced.ts` owns the optional targeting and
combat drills. Localized copy lives under `ui.tutorial` in
the four catalogs. English and German are translated; the two existing stub
catalogs retain matching keys.

## Session and persistence contract

- `useGame.getState().tutorial !== null` identifies a live tutorial session.
- `world.sessionKind === "tutorial"` is the world-level boundary. The exported
  `isTutorialWorld(world)` helper checks it.
- `createTraining` calls `excludeWorldFromPersistence` before installation.
  `canPersistWorld` also rejects the serialized session tag defensively.
  Checkpoint writers and result/reward recording must exclude either condition.
  Do not clear or replace an existing suspended mission when training starts,
  advances, restarts or exits.
- `startTutorial(chapter?)` creates a separate world at synthetic level ID `-1`,
  sets `activeSlot` to `null`, and installs fresh practice progress.
  `tutorialReturnState` preserves the prior store state in memory.
- `exitTutorial()` restores that state, including its original slot, world,
  progress and any checkpoint-related fields. Chapter replay preserves the
  original return state. Practice exits through map/slot navigation also restore
  that state without checkpointing or detaching the original live mission. Pending
  failed-save retry payloads remain untouched. No tutorial data is serialized.
- Training ticks dispatch audiovisual events but bypass campaign discoveries,
  achievements, XP/bolt persistence, result recording and campaign transitions.
  Achievement evaluation also rejects training worlds directly.
- `advanceTutorial()` only succeeds when current action evidence satisfies the
  lesson. Progression purchases call it synchronously because Lab/Robot dialogs
  unmount the canvas and therefore the simulation ticker.
- Training progression dialogs do not add their own simulation pause. They have
  no active wave, and their canvas is unmounted. Existing external/manual pause
  ownership is preserved. Interruption events latch both the training world and
  its suspended return world; swaps enforce blockers and reset engine clocks.

## Input and rendering

World markers use `(x, height, -y)`, matching the existing playfield transform.
They never consume pointer hits. Tutorial actions route through existing store
commands; no Next button satisfies a gameplay lesson.

The first-time offer and chapter selector use `MenuOverlay` and its shared focus
stack. The gameplay objective stays nonmodal. Keyboard hints read the current
key bindings, and tutorial typography uses the app text-scale tokens.

Controller X toggles training HUD focus. D-pad/A uses the regular menu focus
bridge; sticks/A retain the existing field cursor. `tutorialControlsFocused`
suppresses the Placement controller handler so one press cannot also act on the
field. Progression dialogs use the app's normal modal navigation instead.

The map offers training without forcing it. The optional first-time prompt uses
one device-local dismissal preference, separate from campaign saves. Every
chapter and current lesson can be restarted with fresh prerequisites.

## Optional drill contract

The 27-step core path stops at `complete`. The chapter picker separately enters
`targeting` (seven actions plus completion) or `combat` (eight actions plus
completion). Neither optional completion automatically enters another chapter.

- Priorities use contrasting path progress, distance, maximum/current HP and
  species resistance. A committed mode change must produce a real hit on the
  expected target; Mortar Spot must damage two targets through one splash area.
- Combat stages stock Chain, tier-two towers awaiting a real tier-three purchase,
  and genuine Lab Ignite/Flash Freeze effects. Pyre pauses direct fire after
  ignition so its lingering damage is visible. Cryo uses the normal freeze roll;
  moving targets loop within range until both slow and freeze have occurred.
- Shield, healer, regen and resistance chips use production spawn options and
  simulation effects. Adaptation starts from an authored previous-wave damage
  history, uses the production dominant-type selector and adapted-spawn sampler,
  then requires both kinetic and electric damage in the new practice wave. The
  temporary level used for sampling is restored before installing/rendering the
  practice world; it remains excluded from checkpoints throughout.
- Success holds the result on screen for 1.2 simulation seconds before advancing.
  Missing targets restage their original modifiers and action gates. Empty
  adaptive samples retry, without substituting synthetic resistance values.
- Copy reads live tuning values and localized upgrade names. Scenario modifiers
  never grant saved Lab progression or campaign rewards.

The objective measures the robot HUD's top edge, scrolls its instructions within
that space and keeps actions visible. Short landscapes use labelled icon controls;
chapter dialogs are siblings of the objective so they retain shared modal stacking.

## Focused regression command

```sh
node node_modules/vitest/vitest.mjs run src/tutorial/advanced.test.ts src/tutorial/tutorial.test.ts src/tutorial/integration.test.ts src/persistence/storeCheckpoint.test.ts src/persistence/recovery.test.ts src/sessionPause.test.ts src/ui/modalFocus.test.ts src/locales/locales.test.ts --maxWorkers=1
```

Tests exercise actual store commands and simulation ticks through every chapter,
including progression while no tick occurs, rejected/no-op actions, the same
drone's reassignment, real damage and kills, reset prerequisites, exit routes,
permanent-save isolation and unchanged suspended-mission storage.

Full build/typecheck and mouse/touch/controller visual checks belong to the
coordinated integration validation. In particular, verify short landscape
viewports, focus transfer with X, the Lab/Robot dialog handoff, and interruption
pause ownership after merging the parallel save/dialog work.
