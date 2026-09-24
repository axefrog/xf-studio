import type { Layer } from "./recipe";

/** Layer identity and its label do not affect the mask or preview material. */
export function samePreviewInputs(a: Layer, b: Layer): boolean {
  const { id: _aId, name: _aName, ...aInputs } = a;
  const { id: _bId, name: _bName, ...bInputs } = b;
  return JSON.stringify(aInputs) === JSON.stringify(bInputs);
}
