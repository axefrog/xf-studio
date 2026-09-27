/**
 * The five natural-expression samples of experiment 026, written as FACS action-unit recipes on V's main-pose controls and saved in the
 * format the expression editor stores (a `part_presets` row: `{ feature, name, part: { schema: "xfs/expression-part-1", body } }`,
 * which `POST /api/part-presets` accepts as is). The `facs` block beside the part is documentation: which action units each control
 * realises, at which FACS intensity, and why the face reads as natural. The editor ignores it.
 *
 * Values are our own authored numbers, tuned by eye on V in the Studio's live preview (research/animation/natural-expressions.md).
 *
 *     bun experiments/026-natural-expressions/make-samples.ts            writes projects/xf-studio/authoring/data/expression-samples/*.json
 *     bun experiments/026-natural-expressions/make-samples.ts --post <server>/api/verification/part-presets   also saves them there
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseExpressionPart, EXPRESSION_PART_1 } from "../../projects/xf-studio/authoring/src/features/expressions/part";
import { isDirectionPair, pairKey } from "../../projects/xf-studio/authoring/src/engines/facial-rig/vocabulary";

type Step = { au: string; name: string; intensity: string; controls: Record<string, number>; note?: string };
type Recipe = { id: string; name: string; label: string; closestVanilla: string; aus: Step[]; why: string[] };

export const RECIPES: Recipe[] = [
  {
    id: "warm-smile", name: "Warm smile (natural)", label: "Warm smile", closestVanilla: "facial_happy",
    aus: [
      { au: "AU6", name: "Cheek raiser", intensity: "D", controls: { eye_l_oculi_squint_outer_lower: 0.9, eye_r_oculi_squint_outer_lower: 0.85,
        eye_l_oculi_squint_outer_upper: 0.35, eye_r_oculi_squint_outer_upper: 0.3, eye_l_blink: 0.08, eye_r_blink: 0.08, eye_l_brows_lower: 0.06, eye_r_brows_lower: 0.06 },
        note: "Orbicularis oculi, orbital part: lower lids and cheeks rise, the outer brow and upper lid come down a little, so the eyes narrow." },
      { au: "AU7", name: "Lid tightener", intensity: "A", controls: { eye_l_oculi_squint_inner: 0.3, eye_r_oculi_squint_inner: 0.26 } },
      { au: "AU12", name: "Lip corner puller", intensity: "C", controls: { lips_l_corner_up: 0.6, lips_r_corner_up: 0.54 } },
      { au: "AU13", name: "Sharp lip puller", intensity: "B", controls: { lips_l_corner_sharp_up: 0.36, lips_r_corner_sharp_up: 0.3 } },
      { au: "AU14", name: "Dimpler", intensity: "A", controls: { lips_l_corner_wide: 0.1, lips_r_corner_wide: 0.08 } },
      { au: "AU11", name: "Nasolabial deepener", intensity: "B", controls: { lips_l_nasolabialDeepener: 0.35, lips_r_nasolabialDeepener: 0.3 } },
      { au: "AU10", name: "Upper lip raiser", intensity: "A", controls: { lips_l_upper_raise: 0.15, lips_r_upper_raise: 0.12 } },
      { au: "AU25", name: "Lips part", intensity: "B", controls: { lips_apart_up: 0.5, lips_apart_dn: 0.2 } },
      { au: "AU26", name: "Jaw drop", intensity: "A", controls: { jaw_mid_open: 0.07 } },
    ],
    why: [
      "It is a Duchenne smile (AU6 + AU12): the eyes take part. The cheeks lift and the lower lids rise and narrow the eyes, which is what separates a felt smile from a polite one.",
      "The mouth is moderate (AU12 at C, not E), with the upper teeth just showing and the jaw barely open.",
      "The left side is a little stronger than the right on every pair, as real smiles are.",
    ],
  },
  {
    id: "confusion", name: "Confusion (natural)", label: "Confused", closestVanilla: "facial_pissed",
    aus: [
      { au: "AU4", name: "Brow lowerer", intensity: "C (left) / A (right)", controls: { eye_l_brows_lower: 0.55, eye_r_brows_lower: 0.1,
        eye_l_brows_lateral: 0.5, eye_r_brows_lateral: 0.3 }, note: "Corrugator and depressor: the brows knit, one side much more." },
      { au: "AU1+2", name: "Inner and outer brow raiser (right only)", intensity: "C", controls: { eye_r_brows_raise_out: 0.55, eye_r_brows_raise_in: 0.3 },
        note: "The other brow goes up: the questioning brow." },
      { au: "AU7", name: "Lid tightener", intensity: "B (left)", controls: { eye_l_oculi_squint_inner: 0.4, eye_r_oculi_squint_inner: 0.15 } },
      { au: "AU5", name: "Upper lid raiser (right)", intensity: "A", controls: { eye_r_widen: 0.1 } },
      { au: "AU14", name: "Dimpler (unilateral)", intensity: "B", controls: { lips_r_corner_wide: 0.3, lips_mid_shift_r: 0.3 },
        note: "The mouth pulls to one side." },
      { au: "AU15", name: "Lip corner depressor (right)", intensity: "A", controls: { lips_r_corner_dn: 0.1 } },
      { au: "AU17", name: "Chin raiser", intensity: "B", controls: { lips_chin_raise: 0.25 } },
    ],
    why: [
      "Confusion is carried by the brows: AU4 knits and lowers them, and it is the most reported action unit for confusion in the literature.",
      "One brow down and the other up makes the face a question rather than anger. Vanilla faces with knitted brows (furious, pissed) lower both brows hard.",
      "The mouth stays closed and is pulled to one side (unilateral AU14) with a small chin raise (AU17): puzzled, not upset.",
    ],
  },
  {
    id: "disgust", name: "Disgust (natural)", label: "Disgusted", closestVanilla: "facial_disgusted",
    aus: [
      { au: "AU9", name: "Nose wrinkler", intensity: "C (left) / B (right)", controls: { nose_l_snear: 0.55, nose_r_snear: 0.35 } },
      { au: "AU10", name: "Upper lip raiser", intensity: "B (left) / A (right)", controls: { lips_l_upper_raise: 0.4, lips_r_upper_raise: 0.22, lips_l_pull: 0.1 } },
      { au: "AU4", name: "Brow lowerer", intensity: "B", controls: { eye_l_brows_lower: 0.3, eye_r_brows_lower: 0.22, eye_l_brows_lateral: 0.25, eye_r_brows_lateral: 0.2 } },
      { au: "AU6+7", name: "Cheek raiser and lid tightener", intensity: "B", controls: { eye_l_oculi_squint_inner: 0.4, eye_r_oculi_squint_inner: 0.3,
        eye_l_oculi_squint_outer_lower: 0.3, eye_r_oculi_squint_outer_lower: 0.18 }, note: "The nose wrinkle pushes the cheeks up and narrows the eyes." },
      { au: "AU15", name: "Lip corner depressor", intensity: "B", controls: { lips_l_corner_dn: 0.25, lips_r_corner_dn: 0.3 } },
      { au: "AU17", name: "Chin raiser", intensity: "B", controls: { lips_chin_raise: 0.25 } },
      { au: "AU29 (reversed)", name: "Jaw pulled back", intensity: "A", controls: { jaw_mid_shift_back: 0.1 }, note: "A slight withdrawal." },
    ],
    why: [
      "The core of disgust is the nose wrinkle and the raised upper lip (AU9, AU10), here stronger on one side, which is how disgust usually appears.",
      "The eyes narrow from below and the brows lower a little, so the upper face agrees with the mouth.",
      "The jaw stays closed. The vanilla face opens it (jaw open 0.55), which reads as shock or speech.",
    ],
  },
  {
    id: "mild-surprise", name: "Mild surprise (natural)", label: "Mildly surprised", closestVanilla: "facial_surprised",
    aus: [
      { au: "AU1", name: "Inner brow raiser", intensity: "C", controls: { eye_l_brows_raise_in: 0.45, eye_r_brows_raise_in: 0.4 } },
      { au: "AU2", name: "Outer brow raiser", intensity: "B", controls: { eye_l_brows_raise_out: 0.4, eye_r_brows_raise_out: 0.45 } },
      { au: "AU5", name: "Upper lid raiser", intensity: "B", controls: { eye_l_widen: 0.35, eye_r_widen: 0.32 } },
      { au: "AU25+26", name: "Lips part, jaw drop", intensity: "B", controls: { lips_apart_up: 0.12, lips_apart_dn: 0.22, jaw_mid_open: 0.14 } },
    ],
    why: [
      "The classic surprise prototype (AU1 + AU2 + AU5 + AU26) at low intensity: both brows lift evenly, the eyes open a little wider, the jaw drops a few millimetres.",
      "No other action units compete. The vanilla face mixes in cheek suck, lip purse and funnel, throat open and a jaw shift, and opens one eye much wider than the other.",
    ],
  },
  {
    id: "thinking", name: "Thinking deeply (natural)", label: "Thinking", closestVanilla: "facial_bored",
    aus: [
      { au: "AU4", name: "Brow lowerer", intensity: "B", controls: { eye_l_brows_lower: 0.3, eye_r_brows_lower: 0.38, eye_l_brows_lateral: 0.4, eye_r_brows_lateral: 0.4 },
        note: "The concentration furrow." },
      { au: "AU7", name: "Lid tightener", intensity: "B", controls: { eye_l_oculi_squint_inner: 0.3, eye_r_oculi_squint_inner: 0.3 } },
      { au: "AU61+63", name: "Eyes turn left and up", intensity: "C", controls: { eye_l_dir_out: 0.5, eye_r_dir_in: 0.5, eye_l_dir_up: 0.25, eye_r_dir_up: 0.25 },
        note: "A glance away from the listener while thinking; both eyes turn toward V's left." },
      { au: "AU43", name: "Eyes lowered (slight)", intensity: "A", controls: { eye_l_blink: 0.05, eye_r_blink: 0.05 } },
      { au: "AU14", name: "Dimpler (unilateral), mouth to one side", intensity: "B", controls: { lips_mid_shift_l: 0.4, lips_l_corner_wide: 0.3 } },
      { au: "AU17+28", name: "Chin raiser, lower lip in", intensity: "B / A", controls: { lips_chin_raise: 0.3, lips_suck_dn: 0.1 } },
    ],
    why: [
      "A small furrow (AU4 with AU7) and a glance up and to the side are the recognisable signs of someone thinking. The gaze does most of the work.",
      "The mouth is pushed sideways (a one-sided AU14 with a mouth shift) and pressed by a chin raise: a private, unposed face.",
      "Everything stays under about half strength. In photo mode, turn the camera look-at off or the eyes will follow the camera.",
    ],
  },
];

const f32 = (value: number) => Math.fround(value);
export function sample(recipe: Recipe) {
  const controls: Record<string, number> = {};
  for (const step of recipe.aus) for (const [name, value] of Object.entries(step.controls)) {
    if (controls[name] !== undefined) throw Error(`${recipe.id}: ${name} set by two action units`);
    controls[name] = value;
  }
  // Pairs authored with different sides stay unlinked, so editing one side in the drawer keeps the asymmetry.
  const links: Record<string, boolean> = {};
  for (const name of Object.keys(controls)) {
    const key = pairKey(name);
    if (!key || isDirectionPair(name)) continue;
    const other = name.split("_").map(t => t === "l" ? "r" : t === "r" ? "l" : t).join("_");
    if ((controls[name] ?? 0) !== (controls[other] ?? 0)) links[key] = false;
  }
  const authored = Object.fromEntries(Object.keys(controls).sort().map(k => [k, controls[k]!]));
  // Validated by the editor's own codec; the file keeps the authored decimals, which the codec reads to the same float32 weights.
  const parsed = parseExpressionPart({ label: recipe.label, controls: authored, links, origin: { kind: "rest" } });
  for (const [k, v] of Object.entries(parsed.controls)) if (v !== f32(authored[k]!)) throw Error(`${recipe.id}: ${k} does not round-trip`);
  const body = { ...parsed, controls: authored };
  return {
    feature: "expressions", name: recipe.name, part: { schema: EXPRESSION_PART_1, body },
    facs: { closestVanilla: recipe.closestVanilla, actionUnits: recipe.aus.map(({ controls: c, ...rest }) => ({ ...rest, controls: Object.keys(c) })), why: recipe.why,
      source: "XF Studio experiment 026 (research/animation/natural-expressions.md): authored values, tuned in the live preview." },
  };
}

if (import.meta.main) {
  const out = resolve(import.meta.dir, "../../projects/xf-studio/authoring/data/expression-samples");
  mkdirSync(out, { recursive: true });
  const post = process.argv.includes("--post") ? process.argv[process.argv.indexOf("--post") + 1] : undefined;
  for (const recipe of RECIPES) {
    const data = sample(recipe);
    writeFileSync(resolve(out, `${recipe.id}.json`), JSON.stringify(data, null, 2) + "\n");
    console.log(recipe.id, Object.keys(data.part.body.controls).length, "controls");
    if (post) {
      const origin = new URL(post).origin;
      const response = await fetch(post, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ feature: data.feature, name: data.name, part: data.part }) });
      console.log("  saved:", response.status, (await response.text()).slice(0, 120));
    }
  }
}
