import { useLayoutEffect } from "react";
import { listenForSessionInterruptions } from "../sessionPause";
import { useGame } from "../store";
import { useIsMobile, useIsPortrait } from "./useMediaQuery";

export function useSessionInterruptions() {
  const mobile = useIsMobile();
  const portrait = useIsPortrait();
  useLayoutEffect(
    () =>
      listenForSessionInterruptions(document, window, (reason, blocked) =>
        useGame.getState().setInterruptionBlocked(reason, blocked),
      ),
    [],
  );
  useLayoutEffect(() => {
    useGame.getState().setInterruptionBlocked("orientation", mobile && portrait);
  }, [mobile, portrait]);
}
