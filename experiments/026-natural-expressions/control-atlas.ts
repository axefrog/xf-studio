/**
 * Control atlas: what each of V's 141 main-pose controls moves, measured through the Studio's live facial solver.
 *
 * Asks a running isolated Studio server (`--server http://127.0.0.1:<port>`) for the face rig (`GET /api/facial`) and solves every
 * main-pose control alone at weight 0.5 and 1 (`POST /api/facial/solve`), then poses the face skeleton with forward kinematics and
 * reports, per control, which facial regions move, by how much (millimetres) and which way in the face's own frame (left means the
 * character's left). Game-derived numbers go to the ignored `generated/` folder; only the summary facts are quoted in the research note.
 *
 *     bun experiments/026-natural-expressions/control-atlas.ts --server http://127.0.0.1:4463
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { counted, displacement, face, fwdSign, joints, leftSign, len, out, solve, state } from "./lib";

const REGIONS: [RegExp, string][] = [
  [/brows/, "brow"], [/lid_up|lashes_up/, "upper lid"], [/lid_dn|lashes_dn/, "lower lid"], [/lid_corner|wetness/, "lid corner"],
  [/eye_check/, "cheek (orbital)"], [/eye_nose|nose_tip|nostril|nose_nosabial/, "nose"], [/jaw_nosabial/, "cheek (nasolabial)"],
  [/lip_up|lip_corner_inside_up/, "upper lip"], [/lip_dn|lip_corner_inside_dn/, "lower lip"], [/lip_corner/, "mouth corner"],
  [/mug_mouth/, "mouth surround"], [/chin/, "chin"], [/tongue/, "tongue"], [/jaw/, "jaw"], [/_J_eye_JNT|pupil|LeftEye|RightEye/, "eyeball"],
  [/neck|throat|sternocleido|platysma|scapula|butterfly/, "neck"], [/.*/, "other"],
];
const region = (name: string) => REGIONS.find(([pattern]) => pattern.test(name))![1];
const side = (name: string) => name.startsWith("l_") ? "L" : name.startsWith("r_") ? "R" : "mid";

type Entry = { control: string; text: string; group: string; maxMm: number; linearity: number;
  regions: { region: string; side: string; mm: number; left: number; up: number; fwd: number; joint: string }[] };
const atlas: Entry[] = [];

for (const control of state.rig.controls) {
  const full = displacement(await solve({ [control.name]: 1 })), half = displacement(await solve({ [control.name]: 0.5 }));
  let maxMm = 0, sumFull = 0, sumHalfErr = 0;
  const byRegion = new Map<string, Entry["regions"][number]>();
  full.forEach((d, i) => {
    if (!counted[i]) return;
    const mm = len(d); if (mm > maxMm) maxMm = mm;
    sumFull += mm; sumHalfErr += len([half[i]![0] - d[0] / 2, half[i]![1] - d[1] / 2, half[i]![2] - d[2] / 2]);
    const key = `${region(joints[i]!.name)}|${side(joints[i]!.name)}`, best = byRegion.get(key);
    if (mm > 0.05 && (!best || mm > best.mm)) byRegion.set(key, { region: region(joints[i]!.name), side: side(joints[i]!.name), mm, ...face(d), joint: joints[i]!.name });
  });
  atlas.push({ control: control.name, text: control.text, group: control.group, maxMm,
    // 0 = perfectly linear (half weight = half the motion); larger = the rig's in-betweens and limits bend the response.
    linearity: sumFull > 0 ? sumHalfErr / (sumFull / 2) : 0,
    regions: [...byRegion.values()].sort((a, b) => b.mm - a.mm).slice(0, 6) });
}

mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, "control-atlas.json"), JSON.stringify({ frame: { leftSign, fwdSign }, atlas }, null, 1));
const f = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1);
const lines = atlas.map(entry => `${entry.control.padEnd(34)} max ${entry.maxMm.toFixed(1).padStart(5)} mm  nonlin ${entry.linearity.toFixed(2)}  ` +
  entry.regions.slice(0, 4).map(r => `${r.region}/${r.side} ${r.mm.toFixed(1)} (L${f(r.left)} U${f(r.up)} F${f(r.fwd)})`).join("; "));
writeFileSync(resolve(out, "control-atlas.txt"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
