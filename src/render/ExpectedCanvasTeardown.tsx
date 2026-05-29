import { useThree } from "@react-three/fiber";
import { useEffect } from "react";

const EXPECTED_TEARDOWN_FLAG = "expectedContextTeardown";

export const ExpectedCanvasTeardown = () => {
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const canvas = gl.domElement;
    const onContextLost = (event: Event) => {
      if (canvas.dataset[EXPECTED_TEARDOWN_FLAG] !== "true") return;
      event.stopImmediatePropagation();
    };

    canvas.addEventListener("webglcontextlost", onContextLost, { capture: true });
    return () => {
      // R3F intentionally force-loses a WebGL context when a Canvas is
      // destroyed. Mark that teardown so three.js does not report it as an
      // unexpected runtime context loss.
      canvas.dataset[EXPECTED_TEARDOWN_FLAG] = "true";
    };
  }, [gl]);

  return null;
};
