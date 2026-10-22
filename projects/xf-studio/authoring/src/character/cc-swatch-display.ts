/**
 * How a colour row's swatches are shown: the host's derived swatches (cc-swatch.ts) with each set of them contrast-enhanced where it is
 * tightly clustered (swatch-contrast.ts). Pure and DOM-free; the Character panel passes the result to its choice list and keeps the true
 * colours for the row's own chip and the swatch card.
 *
 * - **Sets** are what a person compares within: the choices under one maker heading (cc-panel.ts groups, "Other mods" pooled as one), or the
 *   whole row when it has no headings. A set is recomputed whenever its content changes (another page of choices, swatches arriving, a pack
 *   installed), because the result is keyed by the swatch state and the choices it was computed from.
 * - **Only derived colours** take part: a choice drawn with the game's own atlas icon (cc-swatch.ts "Replaced" rules) stays an icon, and a
 *   choice without a derived swatch keeps its definition colour. Off takes no part.
 * - **Honesty.** `truth` holds the unchanged swatches by position, `enhanced` the positions shown enhanced; the replaced mark (`!`) is kept.
 */
import { type CcPanelChoice, choiceGroup, OTHER_MODS_INDEX } from "./cc-panel";
import type { CharacterSwatchState } from "./character-context-actions";
import { enhanceSwatchSet, type ContrastResult } from "./swatch-contrast";

export type DisplayedSwatchState = CharacterSwatchState & {
  /** The host's swatches, unchanged, by position (what the colour really is). */
  readonly truth: readonly string[];
  /** Positions whose swatch is shown contrast-enhanced. */
  readonly enhanced: ReadonlySet<number>;
  /** Each enhanced set's result (for measurement and the style guide), by set key. */
  readonly sets: ReadonlyMap<number, ContrastResult>;
};
export type SwatchGrouping = { readonly modGroups: readonly number[]; readonly pooled?: readonly number[] } | null;

/** Does this position draw the game's atlas icon rather than a derived colour (character-choices.ts `swatchLook`)? */
const drawsIcon = (state: CharacterSwatchState, position: number) => {
  const text = state.swatches[position] ?? "", icon = state.icons[position] ?? "";
  if (!icon || text.startsWith("!")) return false;
  return !!state.sheets.get(Number(icon.split(":")[0]))?.url;
};

export function displaySwatches(state: CharacterSwatchState, choices: readonly Pick<CcPanelChoice, "position" | "mod" | "off">[],
  grouping: SwatchGrouping): DisplayedSwatchState {
  const pooled = new Set(grouping?.pooled ?? []);
  const sets = new Map<number, { position: number; colours: string[]; replaced: boolean }[]>();
  for (const choice of choices) {
    if (choice.off || drawsIcon(state, choice.position)) continue;
    const text = state.swatches[choice.position] ?? "";
    if (!text) continue;
    const replaced = text.startsWith("!");
    const group = grouping ? choiceGroup(choice, grouping) : 0, key = pooled.has(group) ? OTHER_MODS_INDEX : group;
    const list = sets.get(key) ?? [];
    list.push({ position: choice.position, colours: (replaced ? text.slice(1) : text).split(">"), replaced });
    sets.set(key, list);
  }
  const swatches = [...state.swatches], enhanced = new Set<number>(), results = new Map<number, ContrastResult>();
  for (const [key, members] of sets) {
    const result = enhanceSwatchSet(members.map(member => member.colours));
    if (!result.enhanced) continue;
    results.set(key, result);
    members.forEach((member, at) => {
      swatches[member.position] = `${member.replaced ? "!" : ""}${result.colours[at]!.join(">")}`;
      enhanced.add(member.position);
    });
  }
  return { ...state, swatches, truth: state.swatches, enhanced, sets: results };
}

/** One entry memo per option: the display is recomputed only when the swatch state, the choices or the grouping change. */
export class SwatchDisplayMemo {
  private readonly memo = new Map<string, { state: CharacterSwatchState; choices: readonly unknown[]; grouping: string; result: DisplayedSwatchState }>();
  get(option: string, state: CharacterSwatchState, choices: readonly Pick<CcPanelChoice, "position" | "mod" | "off">[], grouping: SwatchGrouping): DisplayedSwatchState {
    const key = grouping ? `${grouping.modGroups.join(",")}|${(grouping.pooled ?? []).join(",")}` : "";
    const known = this.memo.get(option);
    if (known && known.state === state && known.choices === choices && known.grouping === key) return known.result;
    const result = displaySwatches(state, choices, grouping);
    this.memo.set(option, { state, choices, grouping: key, result });
    return result;
  }
  clear() { this.memo.clear(); }
}
