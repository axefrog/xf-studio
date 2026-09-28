/**
 * The facial solver's parity cases (research/animation/facial-solver-spec.md §9.2) and their comparison against the oracle's answers (§9.4).
 * Built from the rig's track names and the facial setup's own tables, so no control list is typed by hand except the named extras the
 * specification lists; clip frames come from the game's clips through XF Studio's own reader.
 *
 * A fixture holds the inputs and the oracle's answers (game-derived: kept in an ignored folder, never committed):
 *   cases.json  {setup, rig, tracks, joints, cases: [{group, name, start, count}]}
 *   inputs.f32  frames × tracks        q.f32 frames × joints × 4        t.f32 frames × joints × 3        o.f32 frames × tracks
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { clipValuesAt, type ClipTracks } from "../src/engines/facial-rig/anim-tracks";
import { type CompiledFacialRig, createFacialPose, solveFace } from "../src/engines/facial-rig/solver";

export type OracleCase = { readonly group: string; readonly name: string; readonly frames: Float32Array[] };
export type FixtureCase = { readonly group: string; readonly name: string; readonly start: number; readonly count: number };
export type FixtureIndex = { readonly setup: string; readonly rig: string; readonly tracks: number; readonly joints: number; readonly cases: readonly FixtureCase[] };
export type Fixture = { readonly index: FixtureIndex; readonly inputs: Float32Array; readonly q: Float32Array; readonly t: Float32Array; readonly o: Float32Array | null };
/** The clips the clip groups sample (the blink's additive clip, the creator idle's face clips, the photo-mode expressions). */
export type OracleClips = { readonly blink?: ClipTracks; readonly idle?: ClipTracks; readonly idleEyes?: ClipTracks;
  readonly expressions?: ReadonlyMap<string, { tracks: ClipTracks; type: string }> };

type SetupData = { bakedData: { Data: Record<string, Record<string, unknown>> } };
const rows = (setup: SetupData, part: string, table: string) => (setup.bakedData.Data[part]?.[table] ?? []) as Record<string, number>[];
const numbers = (setup: SetupData, part: string, table: string) => (setup.bakedData.Data[part]?.[table] ?? []) as number[];

/** A deterministic generator (mulberry32), so the random group is the same on every run. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The per-part tables the cases are built from. */
function parts(setup: SetupData) {
  return (["Face", "Eyes", "Tongue"] as const).map(part => {
    const main = rows(setup, part, "AllMainPoses"), thresholds = numbers(setup, part, "AllMainPosesInbetweens");
    let at = 0;
    const poses = main.map(row => { const n = row.NumInbetweens!, entry = { track: row.Track!, thresholds: thresholds.slice(at, at + n), first: at }; at += n; return entry; });
    const between = poses.flatMap((pose, i) => pose.thresholds.map((threshold, j) => ({ pose: i, track: pose.track, threshold, j })));
    return { part, poses, between, globals: rows(setup, part, "GlobalCorrectiveEntries"), betweens: rows(setup, part, "InbetweenCorrectiveEntries"),
      influences: rows(setup, part, "InfluencedPoses"), influenceIndices: numbers(setup, part, "InfluenceIndices"),
      correctives: Math.max(0, ...rows(setup, part, "GlobalCorrectiveEntries").map(e => e.Index! + 1), ...rows(setup, part, "InbetweenCorrectiveEntries").map(e => e.Index! + 1)) };
  });
}

/** Every case of §9.2 that the setup and clips allow (groups A to N; group O is `maleCases`). */
export function buildCases(rig: CompiledFacialRig, setupRoot: unknown, clips: OracleClips = {}): OracleCase[] {
  const setup = setupRoot as SetupData, T = rig.trackNames.length, ref = rig.referenceTracks();
  const main = rig.segments.main, overrides = rig.segments.overrides, lipsync = rig.segments.lipsyncPoses;
  const index = (name: string) => { const k = rig.trackIndex(name); if (k < 0) throw Error(`No control ${name}.`); return k; };
  const has = (name: string) => rig.trackIndex(name) >= 0;
  /** Reference plus additive values by name or index; `abs` sets absolute values. */
  const vec = (add: Record<string, number> | Map<number, number> = {}, abs: Record<string, number> = {}) => {
    const v = ref.slice();
    if (add instanceof Map) for (const [k, x] of add) v[k] = v[k]! + x;
    else for (const [name, x] of Object.entries(add)) v[index(name)] = v[index(name)]! + x;
    for (const [name, x] of Object.entries(abs)) v[index(name)] = x;
    return v;
  };
  const cases: OracleCase[] = [];
  const add = (group: string, name: string, ...frames: Float32Array[]) => cases.push({ group, name, frames });
  const P = parts(setup);
  const mainTracks = [...new Set(P.flatMap(p => p.poses.map(pose => pose.track)))].sort((a, b) => a - b);

  // A. Baseline.
  add("A", "neutral", vec());
  add("A", "all tracks 0", new Float32Array(T));
  for (const x of [0.0009, 0.001, 0.0011]) add("A", `lips_l_corner_up ${x}`, vec({ lips_l_corner_up: x }));
  { const v = vec(); for (let k = main.start; k < main.start + main.count; k++) v[k] = v[k]! + 1e-6; add("A", "reference + 1e-6 on every main track", v); }

  // B. Each main pose alone at 0.5 and 1.0.
  for (const k of mainTracks) for (const x of [0.5, 1]) add("B", `${rig.trackNames[k]} ${x}`, vec(new Map([[k, x]])));

  // C. In-between thresholds of every multi-in-between control.
  for (const p of P) for (const pose of p.poses) {
    if (pose.thresholds.length < 2) continue;
    const th = pose.thresholds, values = new Set<number>([0.001, 0.0011, th[0]! / 2]);
    th.forEach(t => { values.add(t); values.add(t - 1e-4); values.add(t + 1e-4); });
    for (let j = 0; j + 1 < th.length; j++) values.add((th[j]! + th[j + 1]!) / 2);
    for (const x of [...values].filter(x => x > 0 && x <= 1.0001).sort((a, b) => a - b))
      add("C", `${p.part} ${rig.trackNames[pose.track]} ${+x.toFixed(6)}`, vec(new Map([[pose.track, x]])));
  }

  // D. Influences: the specification's named ones, then every influenced control at 1 with each of its influencers at 0.4.
  const named: [string, Record<string, number>][] = [
    ["widen 1, blink 0.3", { eye_l_widen: 1, eye_l_blink: 0.3 }], ["widen 1, blink 0.6", { eye_l_widen: 1, eye_l_blink: 0.6 }],
    ["widen 1, blink 1", { eye_l_widen: 1, eye_l_blink: 1 }], ["widen 1, gaze up 0.5", { eye_l_widen: 1, eye_l_dir_up: 0.5 }],
    ["brows lower 1, outer raise 0.4", { eye_l_brows_lower: 1, eye_l_brows_raise_out: 0.4 }],
    ["jaw open 1, close 0.25", { jaw_mid_open: 1, jaw_mid_close: 0.25 }], ["jaw open 1, close 0.5", { jaw_mid_open: 1, jaw_mid_close: 0.5 }],
    ["jaw open 1, close 1", { jaw_mid_open: 1, jaw_mid_close: 1 }]];
  for (const [name, values] of named) if (Object.keys(values).every(has)) add("D", name, vec(values));
  for (const p of P) {
    let at = 0;
    for (const entry of p.influences) {
      const from = p.influenceIndices.slice(at, at + entry.NumInfluences!); at += entry.NumInfluences!;
      const values = new Map<number, number>([[entry.Track!, 1]]);
      for (const k of from) values.set(k, 0.4);
      add("D", `${p.part} ${rig.trackNames[entry.Track!]} 1 with ${from.length} influencers 0.4`, vec(values));
      // Two influencers summing past 1 (the S ≥ 1 cut-off) where there are two.
      if (from.length >= 2) add("D", `${p.part} ${rig.trackNames[entry.Track!]} 1 with influencers 0.5 and 0.7`, vec(new Map([[entry.Track!, 1], [from[0]!, 0.5], [from[1]!, 0.7]])));
    }
  }

  // E. Face scaling.
  const fixed = { eye_l_brows_raise_in: 1, eye_r_brows_raise_in: 1, eye_l_oculi_squint_inner: 1, lips_l_corner_up: 1, lips_r_corner_up: 1, jaw_mid_open: 0.5, eye_l_blink: 0.5 };
  for (const u of [0, 0.5, 1]) for (const l of [0, 0.5, 1]) add("E", `upperFace ${u} lowerFace ${l}`, vec(fixed, { upperFace: u, lowerFace: l }));
  add("E", "upperFace 1.5 (clamp)", vec(fixed, { upperFace: 1.5 })); add("E", "upperFace -0.5 (clamp)", vec(fixed, { upperFace: -0.5 }));

  // F. Muzzles.
  for (const m of [0.5, 1]) {
    add("F", `muzzleEyes ${m}`, vec({ eye_l_blink: 1, eye_r_widen: 1 }, { muzzleEyes: m }));
    add("F", `muzzleBrows ${m}`, vec({ eye_l_brows_raise_in: 1, eye_l_brows_raise_out: 1, eye_r_brows_raise_out: 1 }, { muzzleBrows: m }));
    add("F", `muzzleEyeDirections ${m}`, vec({ eye_l_dir_up: 1, eye_r_dir_in: 1 }, { muzzleEyeDirections: m }));
    add("F", `muzzleLips ${m}, no lipsync`, vec({ lips_l_corner_up: 1, lips_r_corner_up: 1 }, { muzzleLips: m }));
  }

  // G. Lip sync.
  const speech = { lips_l_corner_up: 1, lips_r_corner_up: 1, jaw_mid_open: 1 };
  for (const [jali, other] of [["jaliJaw", "jaliLips"], ["jaliLips", "jaliJaw"]] as const)
    for (const s of [0, 0.5, 1, 1.5, 2]) add("G", `${jali} ${s}`, vec(speech, { lipSyncEnvelope: 1, muzzleLips: 1, [jali]: s, [other]: 1 }));
  add("G", "muzzleLips 0.5", vec(speech, { lipSyncEnvelope: 1, muzzleLips: 0.5 }));
  add("G", "muzzleLips 0.5, jaliLips 0.5", vec(speech, { lipSyncEnvelope: 1, muzzleLips: 0.5, jaliLips: 0.5 }));
  add("G", "lipSyncEnvelope 0, muzzleLips 1", vec(speech, { lipSyncEnvelope: 0, muzzleLips: 1 }));
  const overrideAll = (value: number) => { const out: Record<string, number> = {}; for (let i = 0; i < overrides.count; i++) out[rig.trackNames[overrides.start + i]!] = value; return out; };
  add("G", "overrides 0, lipSyncEnvelope 1", vec(speech, { lipSyncEnvelope: 1, ...overrideAll(0) }));
  add("G", "overrides 0.5, lipSyncEnvelope 1", vec(speech, { lipSyncEnvelope: 1, ...overrideAll(0.5) }));
  add("G", "overrides 0, lipSyncEnvelope 0.5", vec(speech, { lipSyncEnvelope: 0.5, ...overrideAll(0) }));
  const lipsyncOf = (name: string) => lipsync.start + index(name) - main.start;
  add("G", "lipsync pose 0.4 on corners up, main 0", vec(new Map([[lipsyncOf("lips_l_corner_up"), 0.4], [lipsyncOf("lips_r_corner_up"), 0.4]])));
  add("G", "lipsync pose 0.4 on corners up, main 0.8 (clamp)", vec(new Map([[index("lips_l_corner_up"), 0.8], [lipsyncOf("lips_l_corner_up"), 0.4]])));
  add("G", "lipsync pose 0.4 on the blink", vec(new Map([[lipsyncOf("eye_l_blink"), 0.4]])));
  { const tongue = P.find(p => p.part === "Tongue")!; const values: Record<string, number> = {};
    for (const pose of tongue.poses) values[rig.trackNames[pose.track]!] = 0.7;
    add("G", "tongue controls 0.7, muzzleLips 1, lipSyncEnvelope 1", vec(values, { muzzleLips: 1, lipSyncEnvelope: 1 })); }

  // H. Every corrective: its drivers at 1.0 and at 0.6; an in-between driver by its owning control at that in-between's threshold.
  for (const p of P) for (let c = 0; c < p.correctives; c++) {
    for (const level of [1, 0.6]) {
      const values = new Map<number, number>();
      for (const e of p.globals) if (e.Index === c) values.set(e.Track!, level);
      for (const e of p.betweens) if (e.Index === c) { const b = p.between[e.Track!]; if (b) values.set(b.track, level === 1 ? b.threshold : b.threshold * level); }
      const name = p.part === "Face" ? rig.faceCorrectiveNames[c] : p.part === "Tongue" ? rig.tongueCorrectiveNames[c] : undefined;
      add("H", `${p.part} corrective ${c} ${name ?? ""} drivers ${level}`, vec(values));
    }
  }
  const extras: [string, Record<string, number>][] = [
    ["squint inner + outer lower", { eye_l_oculi_squint_inner: 1, eye_l_oculi_squint_outer_lower: 1 }],
    ["gaze down + in", { eye_l_dir_dn: 1, eye_l_dir_in: 1 }],
    ["blink 1, inner brow raise 1, gaze down 1", { eye_l_blink: 1, eye_l_brows_raise_in: 1, eye_l_dir_dn: 1 }],
    ["jaw open 0.5, lip seal up 1", { jaw_mid_open: 0.5, lips_together_up: 1 }], ["jaw open 1, lip seal up 1", { jaw_mid_open: 1, lips_together_up: 1 }],
    ["jaw open 0.5, lip seal down 1", { jaw_mid_open: 0.5, lips_together_dn: 1 }], ["lip seal down 1", { lips_together_dn: 1 }],
    ["lips_suck_dn 1, lip seal down, upper raises", { lips_suck_dn: 1, lips_together_dn: 1, lips_l_upper_raise: 1, lips_r_upper_raise: 1 }],
    ["jaw open 0.5, chin raise 1", { jaw_mid_open: 0.5, lips_chin_raise: 1 }]];
  for (const [name, values] of extras) if (Object.keys(values).every(has)) add("H", name, vec(values));

  // I. The blink.
  for (let s = 1; s <= 10; s++) { add("I", `eye_l_blink ${s / 10}`, vec({ eye_l_blink: s / 10 })); add("I", `eye_r_blink ${s / 10}`, vec({ eye_r_blink: s / 10 })); }
  for (let s = 1; s <= 10; s++) add("I", `both blinks ${s / 10}`, vec({ eye_l_blink: s / 10, eye_r_blink: s / 10 }));
  for (const [name, values] of [["blink 1 widen 1", { eye_l_widen: 1 }], ["blink 1 gaze down 1", { eye_l_dir_dn: 1 }], ["blink 1 gaze up 1", { eye_l_dir_up: 1 }],
    ["blink 1 outer squint 0.5", { eye_l_oculi_squint_outer_upper: 0.5 }]] as const) add("I", name, vec({ eye_l_blink: 1, ...values }));
  if (clips.blink) {
    const clip = clips.blink, count = Math.round(clip.duration * 60) + 1;
    add("I", "additive__blink_normal__01 at 60 Hz", ...Array.from({ length: count }, (_, i) => vec(clipValuesAt(clip, i / 60))));
    const closed = blinkClosedTime(clip, index("eye_l_blink"), index("eye_r_blink"));
    add("I", "closure scrub, 21 steps", ...Array.from({ length: 21 }, (_, i) => vec(clipValuesAt(clip, i / 20 * closed))));
  }

  // J. Creator idle.
  if (clips.idle) add("J", "ui_closeup_shot at 30 Hz", ...sampleClip(clips.idle, 30, vec));
  if (clips.idleEyes) add("J", "ui_closeup_shot_eyes at 30 Hz", ...sampleClip(clips.idleEyes, 30, vec));

  // K. Smile and cheek.
  const smile = { lips_l_corner_up: 1, lips_r_corner_up: 1 };
  add("K", "corners up", vec(smile));
  add("K", "corners up + sharp 0.8", vec({ ...smile, lips_l_corner_sharp_up: 0.8, lips_r_corner_sharp_up: 0.8 }));
  add("K", "corners up + cheek raise", vec({ ...smile, eye_l_oculi_squint_outer_lower: 1, eye_r_oculi_squint_outer_lower: 1 }));
  const stack = { ...smile, eye_l_oculi_squint_outer_lower: 1, eye_r_oculi_squint_outer_lower: 1, lips_l_nasolabialDeepener: 1, lips_r_nasolabialDeepener: 1,
    nose_l_snear: 1, nose_r_snear: 1 };
  if (Object.keys(stack).every(has)) { add("K", "cheek-range stack", vec(stack)); add("K", "cheek-range stack + jaw open 0.5", vec({ ...stack, jaw_mid_open: 0.5 })); }
  const samples = join(import.meta.dir, "..", "data", "expression-samples");
  for (const file of ["warm-smile.json"]) {
    const path = join(samples, file);
    if (!existsSync(path)) continue;
    const controls = (JSON.parse(readFileSync(path, "utf8")) as { part: { body: { controls: Record<string, number> } } }).part.body.controls;
    add("K", `sample ${file}`, vec(Object.fromEntries(Object.entries(controls).filter(([name]) => has(name)))));
  }

  // L. Vanilla expressions (their first frame's main-pose weights, clamped, as the start points decode them), and K's two named ones.
  for (const [name, clip] of clips.expressions ?? []) {
    const values = new Map<number, number>();
    for (let k = main.start; k < main.start + main.count; k++) {
      const keys = clip.tracks.tracks.get(k);
      if (!keys?.values.length) continue;
      const raw = keys.values[0]! - (clip.type === "Additive" || clip.type === "Normal" ? ref[k]! : 0);
      const w = Math.fround(Math.min(1, Math.max(0, raw)));
      if (w > 1e-6) values.set(k, w);
    }
    add(name === "facial_happy" || name === "facial_charming" ? "K" : "L", name, vec(values));
  }

  // M. Random, seeded.
  const rnd = random(0x5eed);
  const mainList = [...mainTracks];
  for (let i = 0; i < 1000; i++) {
    const values = new Map<number, number>(), n = 3 + Math.floor(rnd() * 10);
    for (let c = 0; c < n; c++) values.set(mainList[Math.floor(rnd() * mainList.length)]!, rnd());
    add("M", `sparse ${i}`, vec(values));
  }
  for (let i = 0; i < 200; i++) add("M", `dense ${i}`, vec(new Map(mainList.map(k => [k, rnd()]))));
  for (let i = 0; i < 100; i++) {
    const v = vec(new Map(Array.from({ length: 3 + Math.floor(rnd() * 10) }, () => [mainList[Math.floor(rnd() * mainList.length)]!, rnd()] as [number, number])));
    for (let k = 0; k < 13; k++) {
      const name = rig.trackNames[k]!;
      v[k] = name.startsWith("jali") ? rnd() * 2.2 : name.startsWith("muzzle") || name === "lipSyncEnvelope" ? rnd() : rnd() * 1.2;
    }
    for (let k = overrides.start; k < overrides.start + overrides.count; k++) v[k] = rnd();
    for (let k = lipsync.start; k < lipsync.start + lipsync.count; k++) v[k] = rnd() < 0.2 ? rnd() * 0.5 : 0;
    add("M", `globals ${i}`, v);
  }

  // N. Robustness (the oracle's side; NaN and wrong lengths are the implementation's own tests).
  for (const x of [-1, 2]) { const v = vec(); for (const k of mainList) v[k] = x; add("N", `every main track ${x}`, v); }
  { const v = vec(); v[index("jaw_mid_open")] = 1e6; add("N", "jaw_mid_open 1e6", v); }
  { const v = vec(); v[index("eye_l_blink")] = -1e6; add("N", "eye_l_blink -1e6", v); }
  { const v = vec(); for (let k = 0; k < 13; k++) v[k] = 5; add("N", "envelopes 5", v); }
  { const v = vec(); for (let k = 0; k < 13; k++) v[k] = -5; for (const k of mainList) v[k] = 1; add("N", "envelopes -5, main 1", v); }
  return cases;
}

/** Group O: the second setup on the same rig. */
export function maleCases(rig: CompiledFacialRig, setupRoot: unknown, clips: OracleClips = {}): OracleCase[] {
  const setup = setupRoot as SetupData, ref = rig.referenceTracks(), cases: OracleCase[] = [];
  const vec = (values: Map<number, number>) => { const v = ref.slice(); for (const [k, x] of values) v[k] = v[k]! + x; return v; };
  cases.push({ group: "O", name: "neutral", frames: [vec(new Map())] });
  const tracks = [...new Set(parts(setup).flatMap(p => p.poses.map(pose => pose.track)))].sort((a, b) => a - b);
  for (const k of tracks) cases.push({ group: "O", name: `${rig.trackNames[k]} 1`, frames: [vec(new Map([[k, 1]]))] });
  const l = rig.trackIndex("eye_l_blink"), r = rig.trackIndex("eye_r_blink");
  for (let s = 1; s <= 10; s++) cases.push({ group: "O", name: `both blinks ${s / 10}`, frames: [vec(new Map([[l, s / 10], [r, s / 10]]))] });
  if (clips.idle) cases.push({ group: "O", name: "ui_closeup_shot every tenth frame", frames: sampleClip(clips.idle, 30, add => vec(add)).filter((_, i) => i % 10 === 0) });
  return cases;
}

/** Where the blink's closing half ends: the later of the two blink controls' peaks. */
export function blinkClosedTime(clip: ClipTracks, left: number, right: number): number {
  let best = 0;
  for (const track of [left, right]) {
    const keys = clip.tracks.get(track);
    if (!keys?.values.length) continue;
    let at = 0;
    keys.values.forEach((value, i) => { if (value > keys.values[at]!) at = i; });
    best = Math.max(best, keys.times[at]!);
  }
  return best;
}

/** A clip at `rate` Hz from 0 to its end (the idle bake's samples): round(duration × rate) + 1 frames. */
export function sampleClip(clip: ClipTracks, rate: number, vec: (add: Map<number, number>) => Float32Array): Float32Array[] {
  const count = Math.round(clip.duration * rate) + 1;
  return Array.from({ length: count }, (_, i) => vec(clipValuesAt(clip, Math.min(clip.duration, i / rate))));
}

export function readFixture(dir: string): Fixture | null {
  if (!existsSync(join(dir, "cases.json"))) return null;
  const f32 = (name: string) => { const path = join(dir, name); if (!existsSync(path)) return null; const b = readFileSync(path); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const index = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8")) as FixtureIndex;
  const inputs = f32("inputs.f32"), q = f32("q.f32"), t = f32("t.f32");
  if (!inputs || !q || !t) return null;
  return { index, inputs, q, t, o: f32("o.f32") };
}

/** §9.4 gates. */
export const TOLERANCE = { rotation: 1e-5, translation: 1e-6, tracks: 1e-6 };
export type GroupReport = { group: string; cases: number; passed: number; frames: number;
  worst: { rotation: number; translation: number; tracks: number; rotationAt: string; translationAt: string; tracksAt: string };
  failures: string[] };

/** The rotation between two unit quaternions, radians, up to sign (accurate near zero). */
export function quatAngle(a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number): number {
  const ax = a[ai]!, ay = a[ai + 1]!, az = a[ai + 2]!, aw = a[ai + 3]!, bx = b[bi]!, by = b[bi + 1]!, bz = b[bi + 2]!, bw = b[bi + 3]!;
  // a⁻¹ ⊗ b
  const x = aw * bx - ax * bw - ay * bz + az * by, y = aw * by + ax * bz - ay * bw - az * bx, z = aw * bz - ax * by + ay * bx - az * bw;
  const w = aw * bw + ax * bx + ay * by + az * bz;
  return 2 * Math.atan2(Math.hypot(x, y, z), Math.abs(w));
}

/** Replay a fixture's inputs through `solveFace` and compare with the oracle's answers, per group. */
export function compareFixture(rig: CompiledFacialRig, fixture: Fixture): GroupReport[] {
  const { index, inputs, q, t, o } = fixture, T = index.tracks, J = index.joints;
  if (rig.trackNames.length !== T || rig.jointNames.length !== J) throw Error("The fixture was made for another rig.");
  const pose = createFacialPose(rig), groups = new Map<string, GroupReport>();
  for (const item of index.cases) {
    const g = groups.get(item.group) ?? { group: item.group, cases: 0, passed: 0, frames: 0, failures: [],
      worst: { rotation: 0, translation: 0, tracks: 0, rotationAt: "", translationAt: "", tracksAt: "" } };
    groups.set(item.group, g);
    g.cases++; g.frames += item.count;
    let ok = true;
    for (let f = item.start; f < item.start + item.count; f++) {
      solveFace(rig, inputs.subarray(f * T, (f + 1) * T), pose);
      let rot = 0, rotJ = 0, tr = 0, trJ = 0, tk = 0, tkK = 0;
      for (let j = 0; j < J; j++) {
        const a = quatAngle(pose.rotations, j * 4, q, (f * J + j) * 4);
        if (a > rot) { rot = a; rotJ = j; }
        const d = Math.hypot(pose.translations[j * 3]! - t[(f * J + j) * 3]!, pose.translations[j * 3 + 1]! - t[(f * J + j) * 3 + 1]!, pose.translations[j * 3 + 2]! - t[(f * J + j) * 3 + 2]!);
        if (d > tr) { tr = d; trJ = j; }
      }
      if (o) for (let k = 0; k < T; k++) {
        const a = pose.tracks[k]!, b = o[f * T + k]!;
        const d = a === b ? 0 : Math.abs(a - b);
        if (d > tk || d !== d) { tk = d !== d ? Infinity : d; tkK = k; }
      }
      const at = `${item.name} frame ${f - item.start}`;
      if (rot > g.worst.rotation) { g.worst.rotation = rot; g.worst.rotationAt = `${at}, ${rig.jointNames[rotJ]}`; }
      if (tr > g.worst.translation) { g.worst.translation = tr; g.worst.translationAt = `${at}, ${rig.jointNames[trJ]}`; }
      if (tk > g.worst.tracks) { g.worst.tracks = tk; g.worst.tracksAt = `${at}, ${rig.trackNames[tkK]}`; }
      if (rot > TOLERANCE.rotation || tr > TOLERANCE.translation || tk > TOLERANCE.tracks) {
        if (ok && g.failures.length < 20) g.failures.push(`${at}: rotation ${rot.toExponential(2)} rad (${rig.jointNames[rotJ]}), translation ${tr.toExponential(2)} m (${rig.jointNames[trJ]}), tracks ${tk.toExponential(2)} (${rig.trackNames[tkK]})`);
        ok = false;
      }
    }
    if (ok) g.passed++;
  }
  return [...groups.values()].sort((a, b) => a.group.localeCompare(b.group));
}
