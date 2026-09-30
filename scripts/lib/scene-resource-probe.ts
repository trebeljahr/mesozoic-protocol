// Imported only by the development lifecycle regression script.
import { _roots } from "@react-three/fiber";

export const rendererMemory = () => {
  const root = [..._roots.values()].at(-1);
  if (!root) throw new Error("No mounted R3F canvas");
  return { ...root.store.getState().gl.info.memory };
};
