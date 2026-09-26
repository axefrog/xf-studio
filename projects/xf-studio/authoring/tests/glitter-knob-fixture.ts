import { preparePackageCollection } from "./fixtures/eye-exporter";
// A collection carrying a valid diagnostic glitter knob, for the hosts' PIPE-70 tests: the package library alone would
// honour it, so only a host's own parsing keeps it from the Glitter route.

type Collection = { presets: { id: string; recipe: { layers: { id: string; symmetry: boolean }[] } }[] };

/** The collection with a glitter knob (and accent) on its first all-flat preset. */
export function withGlitterKnob<T extends Collection>(value: T) {
  const plain = preparePackageCollection(value).plan, preset = plain.presets.find(p => p.route === "flat")!;
  const layer = preset.recipe.layers.find(l => l.enabled && l.opacity > 0)!, copy = structuredClone(value);
  // A glitter region is one lid: its layer may not be mirrored by symmetry.
  for (const l of copy.presets.find(p => p.id === preset.id)!.recipe.layers) if (l.id === layer.id) l.symmetry = false;
  return { ...copy, diagnostics: { schema: "xfs/export-diagnostics-1", presets: { [preset.id]: { glitter: {
    base: { roughness: .5, metalness: 0 }, regions: [{ layer: layer.id, mips: "nested", flakes: { sizeMm: .3, sizeSigma: .2, cover: .1,
      tiltSigmaDeg: 25, tiltMaxDeg: 50, roughness: .2, metalness: .8, color: "#e8c46a", seed: 1 } }], accent: { layer: layer.id, share: .1, ev: 1 } } } } } };
}
