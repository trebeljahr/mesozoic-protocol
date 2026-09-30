import { EffectComposerContext } from "@react-three/postprocessing";
import { useContext, useEffect } from "react";

// The installed composer wrapper replaces its composer when the active camera
// changes, but does not release its render targets. Child effects own their
// own lifetimes and may survive the camera change, so do not dispose passes.
export const ComposerBufferCleanup = () => {
  const { composer } = useContext(EffectComposerContext);
  useEffect(
    () => () => {
      composer.inputBuffer.dispose();
      composer.outputBuffer.dispose();
    },
    [composer],
  );
  return null;
};
