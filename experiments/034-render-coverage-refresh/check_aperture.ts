/**
 * Experiment 034, step 3: does XF Studio's lip-aperture reading (`src/mouth-aperture.ts`, PREV-147 step A) pick the lip joints from the
 * facial setup's regions alone, and reproduce step 1's by-name measurement of the creator idle's breaths?
 *
 * Solves `ui_closeup_shot` with the male player setup (the preview's since 29 September) at 30 Hz with XF Studio's own solver and bake
 * (the frames the host serves the page), and reads each frame's aperture with `mouthLipJoints` and `posedParting`. `--fixture <file>`
 * writes the rest, the regions and three baked frames (rest, 2.4 s, 14.4 s) for the unit test (game-derived: keep it in an ignored folder,
 * `projects/xf-studio/authoring/data/private-fixtures/`). Read-only towards the game.
 *
 *   cd projects/xf-studio/authoring
 *   <python> ../../../tools/memory_guard.py --limit 2 -- bun ../../../experiments/034-render-coverage-refresh/check_aperture.ts [--fixture <file>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { decodeAnimClip } from "../../projects/xf-studio/authoring/src/native/anim-set";
import { clipTracksFromKeys } from "../../projects/xf-studio/authoring/src/engines/facial-rig/anim-tracks";
import { bakedRest, bakeFrames, clipFrame } from "../../projects/xf-studio/authoring/src/engines/facial-rig/bake";
import { compileFacialRig } from "../../projects/xf-studio/authoring/src/engines/facial-rig/solver";
import { mouthAperture, mouthLipJoints, posedParting, type FaceRest } from "../../projects/xf-studio/authoring/src/mouth-aperture";
import { openGame, PATHS } from "./game-files";

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(name); return at < 0 ? null : args[at + 1] ?? null; };
const { raw, doc, oodle } = openGame(flag("--game"));
const skeleton = doc(PATHS.skeleton), male = doc(PATHS.male), anims = raw(PATHS.uiFace);
const setup = male.document.Data?.RootChunk ?? male.document;
const regions: number[] = (setup.bakedData?.Data?.JointRegions ?? []).map(Number);
const rig = compileFacialRig(skeleton.document, male.document), rest = bakedRest(rig);
const lips = mouthLipJoints(rest, regions);
if (!lips) throw Error("no lip joints found");
console.log("lips", JSON.stringify(lips));

const clip = decodeAnimClip(anims.bytes, "ui_closeup_shot", oodle.decompress)!;
const tracks = clipTracksFromKeys(clip.duration, clip.trackKeys, clip.constTrackKeys);
const RATE = 30, times: number[] = [];
for (let f = 0; f <= Math.round(clip.duration * RATE); f++) times.push(Math.min(clip.duration, f / RATE));
const baked = bakeFrames(rig, times.map(t => clipFrame(rig, tracks, t)), times);
const n = baked.joints.length;
/** The rest with one baked frame's moving joints over it. */
const frameAt = (f: number): FaceRest => {
  const local = Float32Array.from(rest.local);
  baked.joints.forEach((j, i) => local.set(baked.local.subarray((f * n + i) * 7, (f * n + i) * 7 + 7), j * 10));
  return { names: rest.names, parents: rest.parents, local };
};
const apertures = times.map((_, f) => mouthAperture(posedParting(frameAt(f), lips), lips.rest) * 1000);
const at = (t: number) => apertures[Math.round(t * RATE)]!;
const peak = apertures.reduce((best, value, i) => value > apertures[best]! ? i : best, 0);
const summary = { rest: +(lips.rest * 1000).toFixed(2), at0: +at(0).toFixed(3), at2_4: +at(2.4).toFixed(2), at14_4: +at(14.4).toFixed(2),
  peak: +apertures[peak]!.toFixed(2), peakAt: +(peak / RATE).toFixed(2), secondsOver1mm: +(apertures.filter(v => v >= 1).length / RATE).toFixed(1),
  negativeFrames: apertures.filter(v => v < 0).length, sources: { skeleton: skeleton.sha256, male: male.sha256, anims: anims.sha256 } };
console.log(JSON.stringify(summary, null, 1));

const fixture = flag("--fixture");
if (fixture) {
  const pick = (t: number) => Array.from(frameAt(Math.round(t * RATE)).local);
  mkdirSync(dirname(fixture), { recursive: true });
  writeFileSync(fixture, JSON.stringify({ note: "Game-derived (player face skeleton, male player facial setup, ui_closeup_shot solved by XF Studio). Private.",
    sources: summary.sources, rest: { names: rest.names, parents: rest.parents, local: Array.from(rest.local) }, regions,
    frames: { "0": pick(0), "2.4": pick(2.4), "14.4": pick(14.4) } }));
  console.log("fixture written");
}
