import { ROBOT_SPECS } from "../sim/robotVariants";
import type { RobotVariant } from "../sim/types";
import { type BakeSpec, prewarmIcon, useBakedIcon } from "./bakedIcon";

const ROBOT_URL: Record<RobotVariant, string> = {
  george: "/models/robots/George.glb",
  leela: "/models/robots/Leela.glb",
  mike: "/models/robots/Mike.glb",
  stan: "/models/robots/Stan.glb",
};

const VARIANTS: RobotVariant[] = ["leela", "george", "mike", "stan"];

const specFor = (variant: RobotVariant): BakeSpec => ({
  cacheKey: `robot:${variant}`,
  modelUrl: ROBOT_URL[variant],
  // Mech GLBs are skinned (have animation rig) so SkeletonUtils.clone is
  // what bakedIcon should use.
  skinned: true,
  rotY: -0.35,
  camera: { position: [2.3, 1.7, 1.9], target: [0, 0.5, 0], fov: 38 },
});

export const prewarmRobotIcons = (): void => {
  for (const v of VARIANTS) prewarmIcon(specFor(v));
};

export const RobotPreview = ({ variant }: { variant: RobotVariant }) => {
  const url = useBakedIcon(specFor(variant));
  const tint = ROBOT_SPECS[variant].tint;
  return (
    <div className="robot-swatch" style={{ borderColor: `${tint}55` }}>
      {url ? (
        <img
          className="robot-icon"
          src={url}
          alt=""
          aria-hidden
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        />
      ) : (
        <div className="robot-icon robot-icon-pending" />
      )}
    </div>
  );
};
