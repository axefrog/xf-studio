/**
 * Character-creator facial morph choices and how they reach each mesh, following the game's
 * own data (see knowledge/cc-file-chain.md, "Morph targets"):
 *
 * - A `gameuiMorphInfo` option's **name is the region** (`eyes`, `nose`, …) and each choice names
 *   one **target** (`h091`), or `None` for the unmorphed base. The save stores the same
 *   `(region, target)` pair.
 * - Every morph component (head, eyes, brows, lashes, piercings, …) binds its **own**
 *   `.morphtarget`, whose `targets[]` are `{name, regionName}` pairs. A choice reaches every
 *   component whose morph resource carries that exact pair; a component without it does not
 *   follow that slider. The eye component's `he_000_pwa__morphs.morphtarget` carries the same 21
 *   `eyes` pairs as the head's, which is why the eyeballs move with the eye-shape choice.
 * - WolvenKit's GLB export names each target `<target>_<region>` (`h091_eyes`).
 *
 * Pure: no Three.js and no IO, so the renderer, tests and host share one rule.
 */
export type FaceMorphKey = { target: string; region: string };
export type FaceMorphChoice = {
  /** Choice position (0 = `None`), in the authority mesh's target order (see `faceMorphChoices`). */
  index: number;
  region: string;
  /** Target name, or null for the base mesh (`None`). */
  target: string | null;
  /** Two-digit position label (`01` = base), the creator's own label while the order matches its option. */
  number: string;
};

/** Split a WolvenKit shape-key name `<target>_<region>`; face targets and regions contain no underscore. */
export function parseMorphTargetName(name: string): FaceMorphKey | null {
  const match = /^([A-Za-z0-9]+)_([A-Za-z0-9]+)$/.exec(name);
  return match ? { target: match[1]!, region: match[2]! } : null;
}
export const morphTargetName = (key: FaceMorphKey) => `${key.target}_${key.region}`;

/**
 * The choices of one morph region as the authority mesh (the head) carries them: `None` first,
 * then each of the region's targets in the morph resource's order. For the vanilla `eyes` region
 * (both body genders) this reproduces the CCO option's `morphNames` exactly (`None`, `h011` …),
 * which the creator labels `01` … `22`. Resource order is **not** CCO order in general (the
 * female `nose` option lists `h112` after `h162`), so other regions' selectors must take their
 * order from the merged CCO; the pairing itself never depends on order.
 */
export function faceMorphChoices(targetNames: readonly string[], region: string): FaceMorphChoice[] {
  const targets: string[] = [];
  for (const name of targetNames) {
    const key = parseMorphTargetName(name);
    if (key?.region === region && !targets.includes(key.target)) targets.push(key.target);
  }
  return [null, ...targets].map((target, index) => ({ index, region, target, number: String(index + 1).padStart(2, "0") }));
}

/**
 * Influences a mesh must receive for one region's choice: every target of that region is set,
 * 1 for the chosen `(target, region)` pair and 0 otherwise. Targets of other regions are left out
 * so the caller keeps them. Returns an empty map for a mesh that carries none of the region.
 */
export function faceMorphWeights(targetNames: readonly string[], region: string, target: string | null): Map<number, number> {
  const out = new Map<number, number>();
  targetNames.forEach((name, index) => {
    const key = parseMorphTargetName(name);
    if (key?.region === region) out.set(index, key.target === target ? 1 : 0);
  });
  return out;
}

/** Whether a mesh follows every choice of a region, i.e. carries each of the choices' pairs. */
export function followsFaceMorphChoices(targetNames: readonly string[], choices: readonly FaceMorphChoice[]): boolean {
  const names = new Set(targetNames);
  const morphs = choices.filter(choice => choice.target !== null);
  return morphs.length > 0 && morphs.every(choice => names.has(morphTargetName({ target: choice.target!, region: choice.region })));
}

/** The choice index a saved `(region, target)` pair selects, or undefined when the head lacks it. */
export function faceMorphChoiceIndex(choices: readonly FaceMorphChoice[], target: string | null): number | undefined {
  return choices.find(choice => choice.target === target)?.index;
}
