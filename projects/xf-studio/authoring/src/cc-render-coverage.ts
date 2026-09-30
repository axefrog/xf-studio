/**
 * What the Studio preview can show of each creator option today, so a control can say so honestly. Pure, and decided
 * from the option's own data with the preview plan's rules (character-detail-plan.ts), never from option names:
 *
 * - Both body genders follow the same rules: the preview draws a masculine V's head on his own core head and his body through the
 *   same consumer groups and censorship rules (the male V plan, phases 1 and 4). His beard is a face-group option like the makeup:
 *   `conditional` until resolved, then drawn: its stubble is a face decal and its cards are hair strands, both of which a face option draws
 *   (character-detail-plan.ts `faceChunkDraws`).
 * - **Body and arm** options the third-person body's consumers read (`bodyGroups`, the V with no clothing) are drawn as the body, except those the game's
 *   censorship rule leaves under the underwear cover the preview draws (`bodyOptionDraws`: nipples, genitals), which are drawn only while
 *   the viewer shows V uncensored (`uncensored`, character-detail-plan.ts `bodyRole`); body and arm morphs (breast size, nail length) shape
 *   the body. Other body and arm options (first-person twins, arm cyberware states) are not drawn.
 * - **Morph** options on the head shape the head and every drawn part carrying the same `(target, region)` pair
 *   (face-morphs.ts).
 * - An **appearance** option on one of the preview's detail slots (`DETAIL_UI_SLOTS`: skin type, brows, lashes, hair,
 *   eyes, teeth, piercings) that the third-person head consumes is drawn as that detail; any appearance in the hairstyle controller's
 *   group (`HAIR_GROUP`: a multi-part hairstyle's part rows on slots of their own) is drawn as the hair.
 * - Any other head appearance consumed by the head's face groups (`FACE_GROUPS`) is drawn **where its parts are templates a face
 *   option draws**: face decals (the `mesh_decal` family: makeup, tattoos, scars, face cyberware, stubble) and hair strands (the beard's
 *   cards); other parts are not. Which case applies is known only after resolving a choice, so the status is `conditional`;
 *   `refineCoverage` settles it from what the shown V draws (`shownOutcome`): whole, only in part (some of its parts left out, so the row
 *   must not read as drawn), or not at all.
 * - A **colour-only** controller (no `.app`, e.g. the skin tone) shows through its link followers.
 * - An option that **adds nothing** (an Off placeholder whose only choice is `None`) is shown correctly by drawing nothing;
 *   it takes its slot's coverage so its row reads like the others.
 * - A **switcher** shows what the targets in its first slot show (its main row); other slots it also fills, such as the
 *   hairstyle a face-cyberware choice swaps, don't decide its label.
 *
 * Coverage is the preview's projection of a catalogue (`catalogueCoverage`), computed when it is asked for, never stored in
 * the catalogue: a host-cached catalogue stays right when the preview learns to draw more (CORE-60).
 */
import { bodyGroups, bodyOptionDraws, bodyRole, DETAIL_UI_SLOTS, FACE_GROUPS, HAIR_GROUP, slotGroups, type CensorOption } from "./character-detail-plan";
import type { CcoPart } from "./cco-model";
import type { CcCatalogue } from "./cc-catalogue";
import type { DetailSlot } from "./render-detail";

/** `uncensored`: drawn only while the viewer shows V uncensored (the Character panel's setting); otherwise the game's underwear covers it. */
export type RenderStatus = "rendered" | "conditional" | "uncensored" | "not-rendered";
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
  /** The option's censorship rule (body options: cco-model.ts `censor`). */
  readonly censor?: CensorOption["censor"];
}

const RANK: Record<RenderStatus, number> = { "not-rendered": 0, uncensored: 1, conditional: 2, rendered: 3 };
const WORDS: Record<DetailSlot, string> = { skin: "the skin", face: "a face detail", brows: "the eyebrows", lashes: "the eyelashes",
  hair: "the hair", eyes: "the eyes", teeth: "the teeth", piercings: "the piercings", body: "the body", clothing: "the clothes" };

export const NOT_HEAD = "The 3D view doesn't draw this part of the body, so changing it shows nothing.";
export const UNDER_COVER = "The game's underwear covers it in the 3D view unless your V is shown uncensored (under Body).";
const NOT_CONSUMED = "The head the 3D view draws doesn't use this option, so changing it shows nothing.";
const CONDITIONAL = "Shown when the 3D view can draw its parts (face decals such as makeup, tattoos and scars, or hair such as a beard); other parts aren't drawn yet.";
/** A settled option some of whose parts the 3D view leaves out (render gap plans §6). */
export const PARTLY_SHOWN = "Not fully shown in the 3D view yet.";

/** Coverage of every option, keyed by option ID. */
export function renderCoverage(options: readonly CoverageInput[]): Map<string, RenderCoverage> {
  const result = new Map<string, RenderCoverage>();
  const byPart = (part: CcoPart) => options.filter(option => option.part === part);
  const direct = (option: CoverageInput): RenderCoverage => {
    // A body row names the body, never the head (UI-92).
    if (option.part !== "head") {
      const consumed = option.groups.some(group => bodyGroups(option.part as "body" | "arms").includes(group));
      if (option.type === "morph") return { status: "rendered", detail: "body", note: "Shapes the body." };
      if (option.type !== "appearance" || !option.hasResource || !consumed) return { status: "not-rendered", detail: null, note: NOT_HEAD };
      if (bodyOptionDraws(byPart(option.part), option.name)) return { status: "rendered", detail: "body", note: "Drawn as part of the body." };
      // What the game turns off while it censors nudity draws in the uncensored look; any other rule, or no creator entry, never does.
      return bodyRole(byPart(option.part), option.name, "nudity") === "plain" ? { status: "uncensored", detail: "body", note: UNDER_COVER }
        : { status: "not-rendered", detail: null, note: NOT_HEAD };
    }
    if (option.type === "morph") return { status: "rendered", detail: "morph", note: "Shapes the head and the parts that follow it." };
    if (option.type !== "appearance" || !option.hasResource) return { status: "not-rendered", detail: null, note: NOT_CONSUMED };
    // Everything the hairstyle controller draws is hair, whatever its slot: a multi-part hairstyle's part rows (PREV-109).
    const slot = DETAIL_UI_SLOTS[option.uiSlot] ?? (option.groups.includes(HAIR_GROUP) ? "hair" : undefined);
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
    const siblings = options.filter(other => other !== option && other.part === option.part && other.uiSlot === option.uiSlot && !other.emitsNothing);
    const shown = best(siblings.map(other => result.get(other.id)!));
    result.set(option.id, shown.status === "not-rendered" ? shown : { ...shown, note: "Adds nothing, so the 3D view shows nothing here, as the game does." });
  }
  // Colour-only controllers show through the followers of their link (the skin tone through the skin types).
  for (const option of options) {
    if (option.type !== "appearance" || option.hasResource || !option.link?.key || result.get(option.id)!.status !== "not-rendered") continue;
    const followers = options.filter(other => other !== option && other.link?.key === option.link!.key).map(other => result.get(other.id)!);
    const shown = best(followers);
    if (shown.status !== "not-rendered") result.set(option.id, { ...shown,
      note: `Changes ${shown.detail && shown.detail !== "morph" ? WORDS[shown.detail] : option.part === "head" ? "the head" : "the body"} through the options that follow it.` });
  }
  // Switchers show what their targets show (nested switchers settle in a few passes).
  const byName = new Map(options.map(option => [`${option.part}/${option.name}`, option]));
  for (let pass = 0; pass < 4; pass++) for (const option of options) {
    if (option.type !== "switcher") continue;
    const targets = option.targets.flatMap(name => { const target = byName.get(`${option.part}/${name}`); return target ? [target] : []; });
    const main = targets.filter(target => option.uiSlots.length && target.uiSlot === option.uiSlots[0]);
    const shown = best((main.length ? main : targets).map(target => result.get(target.id)!));
    result.set(option.id, shown.status === "not-rendered" ? { status: "not-rendered", detail: null, note: NOT_CONSUMED } : shown);
  }
  return result;
}

/** How much of an option the shown V draws: all of it, only part of it, or none of it. */
export type ShownOutcome = "whole" | "part" | "none";
/**
 * What the shown V draws of an option, from the record the scene shows (the options its components draw, and of those the ones drawn only
 * in part: render-detail.ts `partial`).
 */
export function shownOutcome(option: string, shown: { readonly drawn: readonly string[]; readonly partial?: readonly string[] }): ShownOutcome {
  if (!shown.drawn.includes(option)) return "none";
  return shown.partial?.includes(option) ? "part" : "whole";
}

/**
 * Settle a `conditional` coverage from what the shown V draws of the option (`shownOutcome`; null while nothing is shown): drawn when all
 * of it is; still `conditional`, with a note that says so, when only part of it is (a beard whose cards were left out never reads as drawn);
 * not drawn when none of it is.
 */
export function refineCoverage(coverage: RenderCoverage, outcome: ShownOutcome | null): RenderCoverage {
  if (coverage.status !== "conditional" || !outcome) return coverage;
  if (outcome === "whole") return { status: "rendered", detail: coverage.detail, note: "Drawn as a face detail." };
  if (outcome === "part") return { status: "conditional", detail: coverage.detail, note: PARTLY_SHOWN };
  return { status: "not-rendered", detail: null, note: "The 3D view can't draw its parts yet." };
}

/** The preview's coverage of every option of a catalogue (a projection owned by the preview side; CORE-60). */
export function catalogueCoverage(catalogue: Pick<CcCatalogue, "options">): Map<string, RenderCoverage> {
  return renderCoverage(catalogue.options.map(option => ({ id: option.id, part: option.part, name: option.name, type: option.type,
    uiSlot: option.uiSlot, link: option.link, hasResource: option.type === "appearance" && !!option.app, groups: option.groups,
    targets: option.targets, uiSlots: option.uiSlots, emitsNothing: option.emitsNothing, ...(option.censor ? { censor: option.censor } : {}) })));
}
