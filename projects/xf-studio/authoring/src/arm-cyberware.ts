/**
 * Which holster state V's third-person arms draw: the rule the game's data give (knowledge/body-rendering.md §1.1), read from the equipped
 * arm cyberware. Pure: the item, a TweakDB lookup port and the merged creator resource in, the state's name and creator group out.
 *
 * The chain [resource] [source]:
 * 1. The save's `ArmsCW` equipment area holds the equipped arm cyberware (save-loadout.ts); empty, the scripts use the base fists.
 * 2. The item's TweakDB record names a `holsteredItem`, whose `appearanceName` is the holster state's name (`holstered_strong`,
 *    `holstered_mantis`, …; `holstered_default` for the fists).
 * 3. The creator resource's `perspectiveInfo` entry of that name gives the third-person group (`holstered_strong_tpp` in the feminine
 *    resource); a resource that doesn't split the state (the masculine one) names its group after the state itself.
 * The engine's own last step (the native lookup from the item in the right-arm slot to the group) is not read [hypothesis]. Nothing here
 * names a cyberware: a mod that adds arm cyberware with its own holstered item and creator group resolves the same way.
 *
 * Every step that can't be followed falls back to the default state, with the reason, so V is never drawn without arms.
 */
import type { CcoResource } from "./cco-model";

/** The holster state without arm cyberware (the base fists' holstered item's `appearanceName`) [resource]. */
export const DEFAULT_HOLSTER = "holstered_default";

/**
 * The TweakDB port: an arm cyberware item's holstered item's `appearanceName` (the holster state's name), by the save's decimal
 * TweakDBID; null when the record or its holstered item isn't in the compiled TweakDB (a TweakXL item), undefined when the TweakDB itself
 * couldn't be read.
 */
export type HolsterLookup = (item: string) => string | null | undefined;

/** Why the arms show the default state although an item is equipped, or none is (plain words, for the record's notes and the log). */
export type ArmsReason = "none-equipped" | "tweakdb-unread" | "item-unknown" | "group-missing";
export type ArmsState = {
  /** The holster state's name (`holstered_strong`). */
  readonly name: string;
  /** Its third-person creator group (`holstered_strong_tpp`), or null when the creator resource has no group for the default state either. */
  readonly group: string | null;
  /** The equipped item (decimal TweakDBID), when there is one. */
  readonly item?: string;
  /** Why the default state is shown; absent when the item's own state is. */
  readonly reason?: ArmsReason;
};

/** The third-person group of a holster state in a creator resource, or null when it has none. */
export function holsterGroup(cco: CcoResource, name: string): string | null {
  const groups = new Set(cco.parts.arms.groups.map(group => group.name));
  const perspective = cco.perspectives?.find(entry => entry.name === name);
  if (perspective?.tpp && groups.has(perspective.tpp)) return perspective.tpp;
  return groups.has(name) ? name : null;
}

/** The arms' holster state for an equipped arm cyberware item (none: the default state). */
export function armsStateFor(item: string | null | undefined, lookup: HolsterLookup, cco: CcoResource): ArmsState {
  const fallback = (reason: ArmsReason): ArmsState => ({ name: DEFAULT_HOLSTER, group: holsterGroup(cco, DEFAULT_HOLSTER), ...(item ? { item } : {}), reason });
  if (!item) return fallback("none-equipped");
  const name = lookup(item);
  if (name === undefined) return fallback("tweakdb-unread");
  if (!name) return fallback("item-unknown");
  const group = holsterGroup(cco, name);
  if (!group) return fallback("group-missing");
  return { name, group, item };
}

/** One plain line for the record's notes: which state the arms show and why. */
export function armsStateNote(state: ArmsState): string {
  const shown = `The arms are drawn in the ${state.name} state (group ${state.group ?? "none"})`;
  switch (state.reason) {
    case undefined: return `${shown}, from the equipped arm cyberware (item ${state.item}).`;
    case "none-equipped": return `${shown}: no arm cyberware is equipped.`;
    case "tweakdb-unread": return `${shown}: the game's TweakDB couldn't be read to follow the equipped arm cyberware (item ${state.item}).`;
    case "item-unknown": return `${shown}: the equipped arm cyberware (item ${state.item}) isn't in the game's compiled TweakDB (a mod's item?).`;
    case "group-missing": return `${shown}: the creator resource has no group for the equipped arm cyberware's state (item ${state.item}).`;
  }
}
