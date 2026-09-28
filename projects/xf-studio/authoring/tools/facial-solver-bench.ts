/**
 * Bench of XF Studio's facial solver (research/animation/facial-solver-spec.md §8.4): compile time, and `solveFace` median and 99th percentile
 * per vector kind (neutral, a blink, a sparse expression, dense random, every control at 1), plus pre-solving the creator idle's 663 frames.
 * Reads the rig, setup and idle clip from the local intake with XF Studio's own reader.
 *
 *   bun tools/facial-solver-bench.ts [--intake <research/consumers>] [--game <folder>] [--runs 5000]
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { clipTracksFromKeys } from "../src/engines/facial-rig/anim-tracks";
import { compileFacialRig, createFacialPose, solveFace, solveFaceFrames } from "../src/engines/facial-rig/solver";
import { decodeAnimClip } from "../src/native/anim-set";
import { loadGameOodle } from "../src/native/oodle";
import { readResource } from "../src/native/resource-document";
import { sampleClip } from "./facial-oracle-cases";
import { intakePaths, primaryCheckout } from "./facial-solver-oracle";
import { configuredGameRoot } from "./configured-game-root";

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(name); return at < 0 ? null : args[at + 1] ?? null; };
const paths = intakePaths(resolve(flag("--intake") ?? join(primaryCheckout(), "research", "consumers")));
const oodle = loadGameOodle(flag("--game") ?? configuredGameRoot()), runs = Number(flag("--runs") ?? 5000);
const document = (path: string) => readResource(new Uint8Array(readFileSync(path)), oodle.decompress, { buffers: "trim" }).document;

const readStart = performance.now();
const rigDoc = document(paths.rig), setupDoc = document(paths.setup);
const readMs = performance.now() - readStart;
const compileTimes: number[] = [];
let rig = compileFacialRig(rigDoc, setupDoc);
for (let i = 0; i < 20; i++) { const a = performance.now(); rig = compileFacialRig(rigDoc, setupDoc); compileTimes.push(performance.now() - a); }
const pose = createFacialPose(rig);
const vec = (values: Record<string, number>) => { const v = rig.referenceTracks(); for (const [k, x] of Object.entries(values)) v[rig.trackIndex(k)]! += x; return v; };
let seed = 1;
const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
const main = rig.segments.main, all: Record<string, number> = {}, dense: Record<string, number> = {};
for (let k = main.start; k < main.start + main.count; k++) { all[rig.trackNames[k]!] = 1; dense[rig.trackNames[k]!] = rnd(); }
const kinds: [string, Float32Array][] = [["neutral", vec({})], ["blink", vec({ eye_l_blink: 1, eye_r_blink: 1 })],
  ["sparse expression", vec({ lips_l_corner_up: 0.8, lips_r_corner_up: 0.8, eye_l_oculi_squint_outer_lower: 0.6, eye_r_oculi_squint_outer_lower: 0.6, jaw_mid_open: 0.2, lips_apart_up: 0.4 })],
  ["dense random", vec(dense)], ["every control at 1", vec(all)]];
const stats = (times: number[]) => { const s = [...times].sort((a, b) => a - b); return { median: s[Math.floor(s.length / 2)]!, p99: s[Math.floor(s.length * 0.99)]!, max: s.at(-1)! }; };
const fmt = (ms: number) => `${ms.toFixed(4)} ms`;
console.log(`read (native) ${readMs.toFixed(1)} ms; compile median ${fmt(stats(compileTimes).median)}`);
for (const [name, v] of kinds) {
  for (let i = 0; i < 500; i++) solveFace(rig, v, pose);
  const times: number[] = [];
  for (let i = 0; i < runs; i++) { const a = performance.now(); solveFace(rig, v, pose); times.push(performance.now() - a); }
  const s = stats(times);
  console.log(`${name.padEnd(20)} median ${fmt(s.median)}  p99 ${fmt(s.p99)}  max ${fmt(s.max)}`);
}
if (existsSync(paths.uiFace)) {
  const clip = decodeAnimClip(new Uint8Array(readFileSync(paths.uiFace)), "ui_closeup_shot", oodle.decompress)!;
  const tracks = clipTracksFromKeys(clip.duration, clip.trackKeys, clip.constTrackKeys);
  const frames = sampleClip(tracks, 30, add => { const v = rig.referenceTracks(); for (const [k, x] of add) v[k]! += x; return v; });
  const flat = new Float32Array(frames.length * rig.trackNames.length);
  frames.forEach((frame, i) => flat.set(frame, i * rig.trackNames.length));
  const a = performance.now();
  solveFaceFrames(rig, flat);
  console.log(`idle pre-solve: ${frames.length} frames in ${(performance.now() - a).toFixed(1)} ms`);
}
