/**
 * What the Studio preview can show of each creator option today, so a control can say so honestly. Pure, and decided
 * from the option's own data with the preview plan's rules (character-detail-plan.ts), never from option names:
 *
 * - The preview draws a **female head** only: body and arm options, and every option of a masculine V, are not drawn.
 * - **Morph** options on the head shape the head and every drawn part carrying the same `(target, region)` pair
 *   (face-morphs.ts).
 * - An **appearance** option on one of the preview's detail slots (`DETAIL_UI_SLOTS`: skin type, brows, lashes, hair,
 *   eyes, piercings) that the third-person head consumes is drawn as that detail.
 * - Any other head appearance consumed by the head's face groups (`FACE_GROUPS`) is drawn **when its parts are face
 *   decals** (the `mesh_decal` family: makeup, tattoos, scars, face cyberware); other parts, such as teeth, are not.
 *   Which case applies is known only after resolving a choice, so the status is `conditional`; `refineCoverage` settles
 *   it from the preview plan's drawn components.
 * - A **colour-only** controller (no `.app`, e.g. the skin tone) shows through its link followers.
 * - An option that **adds nothing** (an Off placeholder whose only choice is `None`) is shown correctly by drawing nothing;
 *   it takes its slot's coverage so its row reads like the others.
 * - A **switcher** shows what the targets in its first slot show (its main row); other slots it also fills, such as the
 *   hairstyle a face-cyberware choice swaps, don't decide its label.
 */
import { DETAIL_UI_SLOTS, FACE_GROUPS, slotGroups } from "./character-detail-plan";
import type { CcoPart } from "./cco-model";
import type { DetailSlot } from "./render-detail";

export type RenderStatus = "rendered" | "conditional" | "not-rendered";
export interface RenderCoverage {
  readonly status: RenderStatus;
  /** The preview detail that draws it (`morph`: the facial shape), when there is one. */
  readonly detail: DetailSlot | "morph" | null;
  /** One plain sentence for the control. */
  readonly note: string;
}
export interface CoverageInput {
  readonly id: string;
  readonly part: CcoPart;
  readonly name: string;
  readonly type: "appearance" | "morph" | "switcher";
  readonly uiSlot: string;
  readonly link: { readonly key: string; readonly controller: boolean } | null;
  readonly hasResource: boolean;
  readonly groups: readonly string[];
  /** Switchers: the option names each choice activates (same part). */
  readonly targets: readonly string[];
  /** Switchers: the slots their choices fill, main slot first. */
  readonly uiSlots: readonly string[];
  /** No choice adds an appearance or a morph. */
  readonly emitsNothing: boolean;
}

const RANK: Record<RenderStatus, number> = { "not-rendered": 0, conditional: 1, rendered: 2 };
const WORDS: Record<DetailSlot, string> = { skin: "the skin", face: "a face detail", brows: "the eyebrows", lashes: "the eyelashes",
  hair: "the hair", eyes: "the eyes", piercings: "the piercings" };

export const NOT_HEAD = "The preview shows the head only, so body and arm options aren't drawn yet.";
export const NO_MALE_HEAD = "The preview has no masculine head yet, so this isn't drawn.";
const NOT_CONSUMED = "The head the preview draws doesn't use this option, so changing it shows nothing.";
const CONDITIONAL = "Shown when its parts are face decals (makeup, tattoos, scars, face cyberware); other parts, such as teeth, aren't drawn yet.";

/** Coverage of every option, keyed by option ID. */
export function renderCoverage(options: readonly CoverageInput[], bodyGender: "female" | "male"): Map<string, RenderCoverage> {
  const result = new Map<string, RenderCoverage>();
  const direct = (option: CoverageInput): RenderCoverage => {
    if (bodyGender === "male") return { status: "not-rendered", detail: null, note: NO_MALE_HEAD };
    if (option.part !== "head") return { status: "not-rendered", detail: null, note: NOT_HEAD };
    if (option.type === "morph") return { status: "rendered", detail: "morph", note: "Shapes the head and the parts that follow it." };
    if (option.type !== "appearance" || !option.hasResource) return { status: "not-rendered", detail: null, note: NOT_CONSUMED };
    const slot = DETAIL_UI_SLOTS[option.uiSlot];
    if (slot && option.groups.some(group => slotGroups(slot).includes(group)))
      return { status: "rendered", detail: slot, note: `Drawn as ${WORDS[slot]}.` };
    if (option.groups.some(group => FACE_GROUPS.includes(group))) return { status: "conditional", detail: "face", note: CONDITIONAL };
    return { status: "not-rendered", detail: null, note: NOT_CONSUMED };
  };
  const best = (list: RenderCoverage[]): RenderCoverage =>
    list.reduce<RenderCoverage | null>((a, b) => !a || RANK[b.status] > RANK[a.status] ? b : a, null)
      ?? { status: "not-rendered", detail: null, note: NOT_CONSUMED };
  for (const option of options) result.set(option.id, direct(option));
  // Options that add nothing read like the other options of their slot.
  for (const option of options) {
    if (!option.emitsNothing || option.type !== "appearance" || option.hasResource || option.link?.key || !option.uiSlot) continue;
    if (bodyGender === "male" || option.part !== "head") continue;
    const siblings = options.filter(other => other !== option && other.part === option.part && other.uiSlot === option.uiSlot && !other.emitsNothing);
    const shown = best(siblings.map(other => result.get(other.id)!));
    result.set(option.id, shown.status === "not-rendered" ? shown : { ...shown, note: "Adds nothing, so the preview shows nothing here, as the game does." });
  }
  // Colour-only controllers show through the followers of their link (the skin tone through the skin types).
  for (const option of options) {
    if (option.type !== "appearance" || option.hasResource || !option.link?.key || result.get(option.id)!.status !== "not-rendered") continue;
    if (bodyGender === "male" || option.part !== "head") continue;
    const followers = options.filter(other => other !== option && other.link?.key === option.link!.key).map(other => result.get(other.id)!);
    const shown = best(followers);
    if (shown.status !== "not-rendered") result.set(option.id, { ...shown, note: `Changes ${shown.detail && shown.detail !== "morph" ? WORDS[shown.detail] : "the head"} through the options that follow it.` });
  }
  // Switchers show what their targets show (nested switchers settle in a few passes).
  const byName = new Map(options.map(option => [`${option.part}/${option.name}`, option]));
  for (let pass = 0; pass < 4; pass++) for (const option of options) {
    if (option.type !== "switcher" || (bodyGender === "male") || option.part !== "head") continue;
    const targets = option.targets.flatMap(name => { const target = byName.get(`${option.part}/${name}`); return target ? [target] : []; });
    const main = targets.filter(target => option.uiSlots.length && target.uiSlot === option.uiSlots[0]);
    const shown = best((main.length ? main : targets).map(target => result.get(target.id)!));
    result.set(option.id, shown.status === "not-rendered" ? { status: "not-rendered", detail: null, note: NOT_CONSUMED } : shown);
  }
  return result;
}

/**
 * Settle a `conditional` coverage from what the preview actually planned for the resolved V: the options with a drawn
 * component are shown, the others that were planned are not.
 */
export function refineCoverage(coverage: RenderCoverage, planned: readonly { readonly drawn: boolean }[]): RenderCoverage {
  if (coverage.status !== "conditional" || !planned.length) return coverage;
  return planned.some(item => item.drawn)
    ? { status: "rendered", detail: coverage.detail, note: "Drawn as a face detail." }
    : { status: "not-rendered", detail: null, note: "Its parts aren't face decals, so the preview doesn't draw them yet." };
}
