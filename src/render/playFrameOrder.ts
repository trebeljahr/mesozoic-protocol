// Drei OrbitControls updates at -1. Preserve the existing play-scene order
// after controls, independent of effect registration/remount order. Negative
// priorities do not take over R3F's automatic rendering/postprocessing.
export const PLAY_PAN_CLAMP_FRAME_PRIORITY = -0.875;
export const PLAY_CAMERA_FRAME_PRIORITY = -0.75;
export const SIMULATION_FRAME_PRIORITY = -0.5;
export const ENEMY_PARTITION_FRAME_PRIORITY = -0.25;
export const ENEMY_MODEL_FRAME_PRIORITY = -0.125;
// Decoration subscribers retain the default priority (0), after model poses.
