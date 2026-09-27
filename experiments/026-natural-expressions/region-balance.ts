/**
 * How much each expression moves the upper, middle and lower face, solved with the live facial solver (lib.ts): the largest skin
 * joint displacement (mm) per region, how many controls sit near the rig's limit (>= 0.7), and the left/right imbalance. Compares
 * the vanilla photo-mode faces with the experiment's natural samples.
 *
 *     bun experiments/026-natural-expressions/region-balance.ts --server http://127.0.0.1:4463
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { counted, displacement, index, joints, len, out, rest, solve } from "./lib";

const REGION = (name: string) => /brows|lid_|lashes|eye_check|wetness|eye_nose/.test(name) ? "upper"
  : /nose|nostril|jaw_nosabial/.test(name) ? "mid" : /mug_|chin|jaw_row|lip/.test(name) ? "lower" : null;
const samples = resolve(import.meta.dir, "../../projects/xf-studio/authoring/data/expression-samples");
const faces: [string, Record<string, number>][] = [];
const installed = JSON.parse(readFileSync(resolve(out, "installed-expressions.json"), "utf8")).items as { clip: string; row: number; controls: Record<string, number> }[];
for (const item of installed.filter(i => i.row < 12 && i.clip !== "facial_neutral")) faces.push([item.clip, item.controls]);
for (const file of readdirSync(samples)) faces.push([`xf:${file.replace(".json", "")}`, JSON.parse(readFileSync(resolve(samples, file), "utf8")).part.body.controls]);

const rows: string[] = [], data: unknown[] = [];
for (const [name, controls] of faces) {
  const d = displacement(await solve(controls));
  const peak: Record<string, number> = { upper: 0, mid: 0, lower: 0 };
  const side: Record<string, number> = { l: 0, r: 0 };
  d.forEach((v, i) => {
    if (!counted[i]) return;
    const region = REGION(joints[i]!.name), mm = len(v);
    if (region && mm > peak[region]!) peak[region] = mm;
    const s = joints[i]!.name.startsWith("l_") ? "l" : joints[i]!.name.startsWith("r_") ? "r" : null;
    if (s && region !== null && mm > side[s]!) side[s] = mm;
  });
  const high = Object.values(controls).filter(v => v >= 0.7).length;
  // Eye involvement: the eye opening (upper to lower lid, middle of the lid) and the lower lid's rise; mouth: the corner's lift.
  const at = (n: string) => { const i = index(n); return { rest: rest[i]!, moved: [rest[i]![0] + d[i]![0], rest[i]![1] + d[i]![1], rest[i]![2] + d[i]![2]] }; };
  const eye = (s: "l" | "r") => { const up = at(`${s}_J_eye_lid_up_rowA_2_JNT`), dn = at(`${s}_J_eye_lid_dn_rowA_1_JNT`);
    const before = up.rest[1] - dn.rest[1], after = up.moved[1] - dn.moved[1];
    return { opening: after / before, lowerLidRise: (dn.moved[1] - dn.rest[1]) * 1000 }; };
  const corner = (s: "l" | "r") => { const c = at(`${s}_J_mug_lip_corner_0_JNT`); return (c.moved[1] - c.rest[1]) * 1000; };
  const eyes = { l: eye("l"), r: eye("r") }, corners = { l: corner("l"), r: corner("r") };
  const ratio = peak.lower! > 0 ? peak.upper! / peak.lower! : 0;
  const imbalance = Math.abs(side.l! - side.r!) / Math.max(side.l!, side.r!, 1e-9);
  data.push({ name, controls: Object.keys(controls).length, high, peak, upperToLower: ratio, imbalance, eyes, corners });
  rows.push(`${name.padEnd(22)} controls ${String(Object.keys(controls).length).padStart(2)}  >=0.7: ${String(high).padStart(2)}  upper ${peak.upper!.toFixed(1).padStart(5)} mm  mid ${peak.mid!.toFixed(1).padStart(5)}  lower ${peak.lower!.toFixed(1).padStart(5)}  upper/lower ${ratio.toFixed(2)}  L/R ${(imbalance * 100).toFixed(0)}%  eye opening ${(eyes.l.opening * 100).toFixed(0)}/${(eyes.r.opening * 100).toFixed(0)}%  lower lid ${eyes.l.lowerLidRise.toFixed(1)}/${eyes.r.lowerLidRise.toFixed(1)} mm  corner lift ${corners.l.toFixed(1)}/${corners.r.toFixed(1)} mm`);
}
writeFileSync(resolve(out, "region-balance.json"), JSON.stringify(data, null, 1));
console.log(rows.join("\n"));
