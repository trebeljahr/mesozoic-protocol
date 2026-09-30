import { IS_DEMO, isLevelBeyondDemo } from "../demo";
import { LEVELS } from "../levels";
import { getStars, isLevelUnlocked, type ProgressData } from "../progress";

export const isMapLevelDiscovered = (id: number, progress: ProgressData) =>
  !isLevelBeyondDemo(id) && (isLevelUnlocked(id, progress) || getStars(progress, id) > 0);

export type MapDiscovery = { radii: number[]; complete: boolean };
export const mapDiscovery = (progress: ProgressData): MapDiscovery => ({
  radii: LEVELS.map((level) =>
    !isMapLevelDiscovered(level.id, progress) ? 0 : getStars(progress, level.id) > 0 ? 11 : 8.5,
  ),
  complete: !IS_DEMO && LEVELS.every((level) => getStars(progress, level.id) > 0),
});

// Re-entering after a win animates only newly discovered ground. Old saves
// load directly into their earned reveal; resetting a slot hides land at once.
export const initialDiscovery = (target: MapDiscovery, previous?: MapDiscovery): MapDiscovery => ({
  radii: target.radii.map((radius, i) => Math.min(radius, previous?.radii[i] ?? radius)),
  complete: target.complete && (previous?.complete ?? true),
});
