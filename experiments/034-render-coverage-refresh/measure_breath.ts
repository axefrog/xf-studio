/**
 * Experiment 034, step 1: does the facial setup change the creator idle's breaths (PREV-147)?
 *
 * Solves the creator close-up loop (`ui_closeup_shot`) and the teeth page loop (`ui_expose_teeth`) from `ui_female_face.anims` on the
 * female face skeleton with each facial setup (the female head's own, which the 27 September measurement used, and the male player setup
 * the face rig names, which the preview has used since 29 September), with XF Studio's own solver, and measures per frame:
 * - the jaw's turn (`mid_J_jaw_JNT` against its rest, degrees);
 * - the midline lip parting: the mean vertical position of the upper lip's midline joints (`[lr]_J_mug_lip_up_0`, and the inside pair)
 *   minus the lower lip's (`[lr]_J_mug_lip_dn_0`, inside pair), change from rest in millimetres (positive = parted);
 * - the lower incisal proxy: how far the jaw's motion alone moves a point at the rest midpoint of the lower lip's inside joints (the
 *   incisor region), down, in millimetres.
 * It also solves the male setup under each of the solver specification's §7 alternatives that could plausibly touch the lips (E1, E2, C1,
 * I1; research/animation/facial-solver-spec.md), one at a time.
 * Read-only towards the game; prints numbers only (game-derived, private when written with --json).
 *
 *   cd projects/xf-studio/authoring
 *   <python> ../../../tools/memory_guard.py --limit 2 -- bun ../../../experiments/034-render-coverage-refresh/measure_breath.ts [--game <folder>] [--json <file>]
 */
import { writeFileSync } from "node:fs";
import { decodeAnimClip, readAnimSetIndex } from "../../projects/xf-studio/authoring/src/native/anim-set";
import { clipTracksFromKeys, type ClipTracks } from "../../projects/xf-studio/authoring/src/engines/facial-rig/anim-tracks";
import { clipFrame } from "../../projects/xf-studio/authoring/src/engines/facial-rig/bake";
import { compileFacialRig, createFacialPose, solveFace, type CompiledFacialRig } from "../../projects/xf-studio/authoring/src/engines/facial-rig/solver";
import { posedLocals, rigRestFromRed, type LocalTransform, type Quat, type RigRest, type Vec3 } from "../../projects/xf-studio/authoring/src/engines/facial-rig/pose";
import { openGame, PATHS } from "./game-files";

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(name); return at < 0 ? null : args[at + 1] ?? null; };
const { raw, doc, oodle } = openGame(flag("--game"));

const skeleton = doc(PATHS.skeleton), female = doc(PATHS.female), male = doc(PATHS.male), anims = raw(PATHS.uiFace);
const root = (d: any) => d.Data?.RootChunk ?? d;
const rest: RigRest = rigRestFromRed(root(skeleton.document));
const rigs: Record<string, CompiledFacialRig> = { female: compileFacialRig(skeleton.document, female.document), male: compileFacialRig(skeleton.document, male.document),
  // The solver specification's §7 alternatives, one at a time on the setup the preview uses (research/animation/facial-solver-spec.md §7).
  "male C1 corrective flag ignored": compileFacialRig(skeleton.document, male.document, { compat: { correctiveFlag: "ignore" } }),
  "male E1 face envelope gates": compileFacialRig(skeleton.document, male.document, { compat: { faceEnvelope: "gate" } }),
  "male E2 lips muzzle mutes": compileFacialRig(skeleton.document, male.document, { compat: { lipsMuzzle: "envelope" } }),
  "male I1 second pass only with lipsync": compileFacialRig(skeleton.document, male.document, { compat: { influencePasses: "second-only-if-lipsync" } }) };
// Which face correctives carry the flag C1 reads (entries whose `Unknown` is 1).
{
  const setup = root(male.document), names: string[] = (setup.faceCorrectiveNames ?? []).map((n: any) => String(n?.$value ?? n));
  const entries: any[] = setup.bakedData?.Data?.CorrectiveInfluences ?? setup.bakedData?.Data?.Face?.CorrectiveEntries ?? [];
  console.log("face correctives", names.length, "entry tables", Object.keys(setup.bakedData?.Data ?? {}).join(","));
  void entries;
}

// Quaternion helpers (x, y, z, w), glTF axes as pose.ts gives them.
const qmul = (a: Quat, b: Quat): Quat => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qinv = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q: Quat, v: Vec3): Vec3 => { const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q)); return [p[0], p[1], p[2]]; };
const qangle = (a: Quat, b: Quat) => { const d = qmul(qinv(a), b); return 2 * Math.atan2(Math.hypot(d[0], d[1], d[2]), Math.abs(d[3])) * 180 / Math.PI; };

type World = { p: Vec3[]; r: Quat[] };
function world(locals?: ReadonlyMap<number, LocalTransform>): World {
  const p: Vec3[] = [], r: Quat[] = [];
  rest.joints.forEach((joint, i) => {
    const local = locals?.get(i) ?? { t: joint.t, r: joint.r };
    if (joint.parent < 0) { p[i] = [...local.t]; r[i] = [...local.r]; return; }
    const s = rest.joints[joint.parent]!.s, o = qrot(r[joint.parent]!, [local.t[0] * s[0], local.t[1] * s[1], local.t[2] * s[2]]);
    p[i] = [p[joint.parent]![0] + o[0], p[joint.parent]![1] + o[1], p[joint.parent]![2] + o[2]];
    r[i] = qmul(r[joint.parent]!, local.r);
  });
  return { p, r };
}
const names = rest.joints.map(j => j.name), idx = (n: string) => { const i = names.indexOf(n); if (i < 0) throw Error(n); return i; };
const J = { jaw: idx("mid_J_jaw_JNT"), head: idx("Head"),
  up: ["l_J_mug_lip_up_0_JNT", "r_J_mug_lip_up_0_JNT"].map(idx), upIn: ["l_J_mug_lip_up_inside_0_JNT", "r_J_mug_lip_up_inside_0_JNT"].map(idx),
  dn: ["l_J_mug_lip_dn_0_JNT", "r_J_mug_lip_dn_0_JNT"].map(idx), dnIn: ["l_J_mug_lip_dn_inside_0_JNT", "r_J_mug_lip_dn_inside_0_JNT"].map(idx) };
const restW = world();
// Everything in the Head joint's frame, so motion above the face (neck) drops out; y is up in glTF axes.
const restW0 = world();
// Offsets from Head, carried into the rest pose's world axes (y up), so a moving neck would drop out.
const inHead = (w: World, v: Vec3): Vec3 => qrot(qmul(restW0.r[J.head]!, qinv(w.r[J.head]!)), [v[0] - w.p[J.head]![0], v[1] - w.p[J.head]![1], v[2] - w.p[J.head]![2]]);
const meanY = (w: World, list: number[]) => list.reduce((s, j) => s + inHead(w, w.p[j]!)[1], 0) / list.length;
const incisor: Vec3 = J.dnIn.reduce<Vec3>((s, j) => [s[0] + restW.p[j]![0] / 2, s[1] + restW.p[j]![1] / 2, s[2] + restW.p[j]![2] / 2], [0, 0, 0]);
const restInc = inHead(restW, incisor);

function measure(w: World) {
  // The rest point carried by the jaw's world motion (rest world → posed world).
  const rel = qmul(w.r[J.jaw]!, qinv(restW.r[J.jaw]!)), d: Vec3 = [incisor[0] - restW.p[J.jaw]![0], incisor[1] - restW.p[J.jaw]![1], incisor[2] - restW.p[J.jaw]![2]];
  const m = qrot(rel, d), moved: Vec3 = [w.p[J.jaw]![0] + m[0], w.p[J.jaw]![1] + m[1], w.p[J.jaw]![2] + m[2]];
  const inc = inHead(w, moved);
  const jawLocal = qmul(qinv(w.r[rest.joints[J.jaw]!.parent]!), w.r[J.jaw]!), jawRestLocal = qmul(qinv(restW.r[rest.joints[J.jaw]!.parent]!), restW.r[J.jaw]!);
  return {
    jawDeg: qangle(jawRestLocal, jawLocal),
    partOuter: ((meanY(w, J.up) - meanY(w, J.dn)) - (meanY(restW, J.up) - meanY(restW, J.dn))) * 1000,
    partInner: ((meanY(w, J.upIn) - meanY(w, J.dnIn)) - (meanY(restW, J.upIn) - meanY(restW, J.dnIn))) * 1000,
    upperLipUp: (meanY(w, J.up) - meanY(restW, J.up)) * 1000, lowerLipDown: -(meanY(w, J.dn) - meanY(restW, J.dn)) * 1000,
    incisorDrop: -(inc[1] - restInc[1]) * 1000, incisorBack: (inc[2] - restInc[2]) * 1000,
  };
}

const index = readAnimSetIndex(anims.bytes);
const clips: Record<string, ClipTracks> = {};
for (const name of ["ui_closeup_shot", "ui_expose_teeth"]) {
  if (!index.clips.some(c => c.name === name)) { console.log(`${name}: not in the set`); continue; }
  const clip = decodeAnimClip(anims.bytes, name, oodle.decompress)!;
  clips[name] = clipTracksFromKeys(clip.duration, clip.trackKeys, clip.constTrackKeys);
  console.log(name, "type", clip.animationType, "duration", clip.duration.toFixed(2));
}

const out: Record<string, unknown> = { sources: { skeleton: skeleton.sha256, female: female.sha256, male: male.sha256, anims: anims.sha256 } };
const RATE = 30;
for (const [clipName, clip] of Object.entries(clips)) {
  const series: Record<string, ReturnType<typeof measure>[]> = {};
  for (const [setup, rig] of Object.entries(rigs)) {
    const pose = createFacialPose(rig), list: ReturnType<typeof measure>[] = [];
    for (let f = 0; f <= Math.round(clip.duration * RATE); f++) {
      const t = Math.min(clip.duration, f / RATE);
      solveFace(rig, clipFrame(rig, clip, t), pose);
      list.push(measure(world(posedLocals(rest, { q: pose.rotations, t: pose.translations }))));
    }
    series[setup] = list;
  }
  const keys = Object.keys(series.female![0]!) as (keyof ReturnType<typeof measure>)[];
  const summary: Record<string, unknown> = {};
  for (const setup of Object.keys(series)) {
    const list = series[setup]!;
    const at = (t: number) => list[Math.round(t * RATE)]!;
    const peak = list.reduce((best, m, i) => m.partOuter > list[best]!.partOuter ? i : best, 0);
    summary[setup] = {
      maxima: Object.fromEntries(keys.map(k => [k, +Math.max(...list.map(m => m[k])).toFixed(2)])),
      peakPartingAt: +(peak / RATE).toFixed(2), atPeak: Object.fromEntries(keys.map(k => [k, +list[peak]![k].toFixed(2)])),
      samples: Object.fromEntries([2.4, 6.0, 14.4, 18.4].filter(t => t <= clip.duration).map(t => [t, Object.fromEntries(keys.map(k => [k, +at(t)[k].toFixed(2)]))])),
    };
  }
  // Frames whose parting is at least 1 mm, per setup: how long the mouth shows a gap.
  for (const setup of Object.keys(series)) (summary[setup] as any).secondsParted1mm = +(series[setup]!.filter(m => m.partOuter >= 1).length / RATE).toFixed(2);
  // Largest per-frame difference between the two setups.
  (summary as any).maleMinusFemaleMax = Object.fromEntries(keys.map(k => [k, +Math.max(...series.male!.map((m, i) => Math.abs(m[k] - series.female![i]![k]))).toFixed(2)]));
  out[clipName] = summary;
  console.log(`\n== ${clipName}\n${JSON.stringify(summary, null, 1)}`);
}
const json = flag("--json");
if (json) writeFileSync(json, JSON.stringify(out, null, 1));
