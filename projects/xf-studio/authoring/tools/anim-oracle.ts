/**
 * Oracle for the native animation decoder (R&D; read-only towards the game and mods): decodes clips natively (src/native/anim-set.ts) and
 * compares every key with WolvenKit's glTF export of the same clip (`projects/xf-studio/tools/anim-export`, which calls WolvenKit's own
 * animation exporter). WolvenKit is GPL-3.0 and runs only as an external program here.
 *
 *   bun tools/anim-oracle.ts --game <game folder> [--mods <MO2 mods folder>] --out <folder> --anim-export <AnimExport.exe> (or XFS_ANIM_EXPORT)
 *     --clip "<set depot path>|<clip name>[|<archive file name>]" [--clip ...] [--rig <rig depot path>] [--report <file>]
 *
 * The set and the rig are read natively from the named archive (a game archive by default) into `--out`, exported once per clip (skipped
 * when the GLB is already there), and compared channel by channel: WolvenKit writes one sampler per keyed joint channel, in glTF axes
 * (game x, y, z → x, z, −y; a quaternion's w unchanged), holding the animated keys, else the constant key. Float tracks come from the
 * export's extras. Run it under tools/memory_guard.py (WolvenKit's exporter peaks near 1.6 GB).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { depotHash } from "../src/depot-path";
import { NativeArchivePool } from "../src/native/archive-reader";
import { decodeAnimClip, type JointKey, readAnimRig, readAnimSetIndex } from "../src/native/anim-set";
import { loadGameOodle } from "../src/native/oodle";

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const options = (name: string) => args.flatMap((value, i) => args[i - 1] === `--${name}` ? [value] : []);
const game = option("game"), out = option("out"), mods = option("mods"), exporter = option("anim-export") ?? process.env.XFS_ANIM_EXPORT;
const rigPath = option("rig") ?? "base\\characters\\base_entities\\woman_base\\woman_base.rig";
const clips = options("clip").map(text => { const [set, clip, archive] = text.split("|"); return { set: set!, clip: clip!, archive: archive ?? null }; });
if (!game || !out || !exporter || !clips.length) {
  console.error("usage: bun tools/anim-oracle.ts --game <folder> [--mods <MO2 mods>] --out <folder> --anim-export <AnimExport.exe> --clip \"<set>|<clip>[|<archive>]\" ... [--rig <path>] [--report file]");
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const byName = new Map<string, string[]>();
const addDir = (dir: string) => { if (!existsSync(dir)) return; for (const name of readdirSync(dir)) if (name.toLowerCase().endsWith(".archive")) byName.set(name.toLowerCase(), [...(byName.get(name.toLowerCase()) ?? []), join(dir, name)]); };
for (const group of ["content", "ep1", "mod"]) addDir(join(game, "archive", "pc", group));
if (mods && existsSync(mods)) for (const mod of readdirSync(mods)) addDir(join(mods, mod, "archive", "pc", "mod"));
const gameArchives = ["content", "ep1"].flatMap(group => { const dir = join(game, "archive", "pc", group); return existsSync(dir) ? readdirSync(dir).filter(n => n.endsWith(".archive")).map(n => join(dir, n)) : []; });
const oodle = loadGameOodle(game);
const pool = new NativeArchivePool(oodle.decompress);
const extract = (depotPath: string, archiveName: string | null): { file: string; bytes: Uint8Array; archive: string } => {
  const hash = depotHash(depotPath);
  const candidates = archiveName ? byName.get(archiveName.toLowerCase()) ?? [] : gameArchives;
  const archive = candidates.find(path => { try { return pool.get(path).has(hash); } catch { return false; } });
  if (!archive) throw Error(`not found: ${depotPath} (${archiveName ?? "game"})`);
  const bytes = pool.read(archive, hash)!;
  const file = join(out, `${hash}-${basename(depotPath.replace(/\\/g, "/"))}`);
  writeFileSync(file, bytes);
  return { file, bytes, archive: basename(archive) };
};

/** glTF (x, y, z) from game (x, y, z), as WolvenKit's exporter converts: y and z swap, the new z negated except for a scale. */
const toGltf = (key: JointKey): number[] => key.channel === "rotation" ? [key.value[0]!, key.value[2]!, -key.value[1]!, key.value[3]!]
  : key.channel === "scale" ? [key.value[0]!, key.value[2]!, key.value[1]!] : [key.value[0]!, key.value[2]!, -key.value[1]!];
/** Largest component difference counted as WolvenKit's identity snap: about five quantisation steps (2/65535 each). */
const SNAP = 5e-4;
const sameRotation = (a: readonly number[], b: readonly number[]) => Math.min(Math.max(...a.map((v, i) => Math.abs(v - b[i]!))), Math.max(...a.map((v, i) => Math.abs(v + b[i]!))));

function readGlb(file: string) {
  const b = readFileSync(file);
  const length = b.readUInt32LE(12), json = JSON.parse(b.subarray(20, 20 + length).toString());
  const binStart = 20 + length + 8, bin = b.subarray(binStart);
  const accessor = (index: number): number[][] => {
    const a = json.accessors[index], view = json.bufferViews[a.bufferView];
    const width = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type as string]!;
    const floats = new Float32Array(bin.buffer.slice(bin.byteOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0), bin.byteOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + a.count * width * 4));
    return Array.from({ length: a.count }, (_, i) => Array.from(floats.subarray(i * width, i * width + width)));
  };
  return { json, accessor };
}

const rig = readAnimRig(extract(rigPath, null).bytes);
const rigFile = join(out, `${depotHash(rigPath)}-${basename(rigPath.replace(/\\/g, "/"))}`);
const report: unknown[] = [];
let failures = 0;
for (const wanted of clips) {
  const set = extract(wanted.set, wanted.archive);
  const clip = decodeAnimClip(set.bytes, wanted.clip, oodle.decompress);
  if (!clip) { console.error(`${wanted.clip}: not in ${wanted.set}`); failures++; continue; }
  const glb = join(out, `${depotHash(wanted.set)}-${wanted.clip}.glb`);
  if (!existsSync(glb)) {
    const run = Bun.spawnSync([exporter, set.file, rigFile, wanted.clip, glb], { stdout: "pipe", stderr: "pipe" });
    if (run.exitCode !== 0 || !existsSync(glb)) { console.error(`${wanted.clip}: WolvenKit export failed\n${run.stderr.toString().slice(-800)}`); failures++; continue; }
  }
  const { json, accessor } = readGlb(glb);
  const nodeBone = new Map<number, number>(json.nodes.map((node: { name: string }, i: number) => [i, rig.bones.indexOf(node.name)] as const));
  const animation = json.animations[0];
  const mine = new Map<string, JointKey[]>();
  const animated = new Set(clip.keys.map(key => `${key.joint}|${key.channel}`));
  for (const key of [...clip.keys, ...clip.constKeys.filter(key => !animated.has(`${key.joint}|${key.channel}`))]) {
    const id = `${key.joint}|${key.channel}`; mine.set(id, [...(mine.get(id) ?? []), key]);
  }
  let worstValue = 0, worstTime = 0, compared = 0, channels = 0, withinStep = 0;
  const problems: string[] = [];
  const seen = new Set<string>();
  // WolvenKit writes a clip's motion extraction (root motion) into Root's channels; the native decoder leaves motion extraction out
  // (the Studio keeps V in place), so Root is not compared for such a clip.
  const skipRoot = clip.motionExtraction;
  for (const channel of animation.channels) {
    const joint = nodeBone.get(channel.target.node)!;
    if (skipRoot && joint === 0) continue;
    const path = channel.target.path === "translation" ? "position" : channel.target.path;
    const id = `${joint}|${path}`;
    seen.add(id);
    const sampler = animation.samplers[channel.sampler];
    const times = accessor(sampler.input).map(v => v[0]!), values = accessor(sampler.output);
    const keys = (mine.get(id) ?? []).slice().sort((a, b) => a.time - b.time);
    channels++;
    if (keys.length !== times.length) { problems.push(`${rig.bones[joint]} ${path}: ${keys.length} keys natively, ${times.length} in WolvenKit's export`); continue; }
    keys.forEach((key, i) => {
      const ours = toGltf(key), theirs = values[i]!;
      const error = path === "rotation" ? sameRotation(ours, theirs) : Math.max(...ours.map((v, k) => Math.abs(v - theirs[k]!)));
      if (process.env.XFS_ORACLE_DEBUG && error > 1e-5) console.log(rig.bones[joint], path, key.time, times[i], ours, theirs, error);
      // WolvenKit's export writes an exact identity for some rotations within about 1e-4 of it, quantised or float (at most 0.02°): counted
      // apart, not as a disagreement.
      if (path === "rotation" && error > 1e-5 && error <= SNAP && theirs.join() === "0,0,0,1") { withinStep++; return; }
      worstValue = Math.max(worstValue, error); worstTime = Math.max(worstTime, Math.abs(key.time - times[i]!)); compared++;
    });
  }
  for (const id of mine.keys()) if (!seen.has(id) && !(skipRoot && id.startsWith("0|"))) problems.push(`${rig.bones[Number(id.split("|")[0])]} ${id.split("|")[1]}: keyed natively, absent from WolvenKit's export`);
  const extras = animation.extras ?? {};
  const trackError = (ours: readonly { track: number; time: number; value: number }[], theirs: { trackIndex: number; time: number; value: number }[] = []) => {
    if (ours.length !== theirs.length) { problems.push(`float tracks: ${ours.length} natively, ${theirs.length} in WolvenKit's export`); return 0; }
    return Math.max(0, ...ours.map((key, i) => Math.max(Math.abs(key.value - theirs[i]!.value), Math.abs(key.time - theirs[i]!.time) > 1e-4 ? 1 : 0)));
  };
  const trackWorst = Math.max(trackError(clip.trackKeys, extras.trackKeys), trackError(clip.constTrackKeys, extras.constTrackKeys));
  const pass = !problems.length && worstValue <= 1e-5 && worstTime <= 1e-4 && trackWorst <= 1e-5;
  if (!pass) failures++;
  const row = { set: wanted.set, clip: wanted.clip, archive: set.archive, frames: clip.frames, duration: clip.duration, counts: clip.counts,
    channels, keysCompared: compared, wolvenKitIdentitySnaps: withinStep, rootMotionSkipped: skipRoot, worstValue, worstTime, worstTrack: trackWorst, pass, problems: problems.slice(0, 10) };
  report.push(row);
  console.log(`${pass ? "PASS" : "FAIL"} ${wanted.clip} (${set.archive}): ${clip.frames} frames, ${channels} channels, ${compared} keys, worst ${worstValue.toExponential(2)}${withinStep ? `, ${withinStep} near-identity rotations WolvenKit writes as identity` : ""}` +
    `${problems.length ? `; ${problems.length} problems: ${problems.slice(0, 3).join("; ")}` : ""}`);
}
if (option("report")) writeFileSync(option("report")!, JSON.stringify({ rig: rigPath, clips: report }, null, 2));
process.exit(failures ? 1 : 0);
