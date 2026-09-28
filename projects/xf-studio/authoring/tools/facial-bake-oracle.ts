/**
 * Oracle for the host's face bakes (facial-host.ts `blink`, idle-host.ts `face`): XF Studio's own solver's idle faces and blink, read from
 * the configured game route, against a developer preparation's GLBs (the pinned IO Suite bakes, `tools/bake_idle_face.py` and
 * `tools/bake_game_blink.py`): every moving joint's local translation and rotation at every key, the joint sets, and the blink's eye-shape
 * seats. Read-only towards the game.
 *
 *   bun tools/facial-bake-oracle.ts --assets <folder with cc-idle-face*.glb and game-blink.glb> [--cache <resolver cache>] [--report <file>]
 *
 * Run it under tools/memory_guard.py (the route's archives are indexed).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FacialHost } from "../src/facial-host";
import { IdleHost } from "../src/idle-host";
import { characterRoute, installationFingerprint } from "../src/character-detail-host";
import { LocalSettingsStore } from "../src/local-settings-store";
import { packageToolPaths } from "../src/local-settings-readiness";
import type { FaceMotionClip, FaceMotionRest } from "../src/platform/api/facial";

type Glb = { json: { nodes: { name?: string }[]; asset: { extras?: Record<string, unknown> }; animations: { name: string; channels: { sampler: number; target: { node: number; path: string } }[];
  samplers: { input: number; output: number }[] }[]; accessors: { bufferView: number; byteOffset?: number; count: number; type: string }[]; bufferViews: { byteOffset?: number }[] }; bin: Buffer };
function readGlb(file: string): Glb {
  const b = readFileSync(file), length = b.readUInt32LE(12);
  return { json: JSON.parse(b.subarray(20, 20 + length).toString()), bin: b.subarray(20 + length + 8) };
}
function accessor(glb: Glb, index: number): Float32Array {
  const a = glb.json.accessors[index]!, view = glb.json.bufferViews[a.bufferView]!, width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type]!;
  const start = glb.bin.byteOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return new Float32Array(glb.bin.buffer.slice(start, start + a.count * width * 4));
}
const floats = (text: string) => { const b = Buffer.from(text, "base64"); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
/** The rotation between two quaternions, degrees, up to sign (from the relative rotation's vector part: accurate near zero). */
const angle = (a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number) => {
  const ax = a[ai]!, ay = a[ai + 1]!, az = a[ai + 2]!, aw = a[ai + 3]!, bx = b[bi]!, by = b[bi + 1]!, bz = b[bi + 2]!, bw = b[bi + 3]!;
  const x = aw * bx - ax * bw - ay * bz + az * by, y = aw * by + ax * bz - ay * bw - az * bx, z = aw * bz - ax * by + ay * bx - az * bw, w = aw * bw + ax * bx + ay * by + az * bz;
  return 2 * Math.atan2(Math.hypot(x, y, z), Math.abs(w)) * 180 / Math.PI;
};

export type ClipComparison = { clip: string; frames: number; preparedFrames: number; joints: number; preparedJoints: number; onlyNative: string[]; onlyPrepared: string[];
  millimetres: number; degrees: number; at: string };

/** One native clip against one animation of a prepared GLB, key for key (times must agree). */
export function compareClip(native: { rest: FaceMotionRest; clip: FaceMotionClip }, glb: Glb, animation: string): ClipComparison {
  const anim = glb.json.animations.find(item => item.name === animation);
  if (!anim) throw Error(`The prepared file has no ${animation}.`);
  const times = floats(native.clip.times), local = floats(native.clip.local), n = native.clip.joints.length;
  const channels = new Map<string, { position?: Float32Array; rotation?: Float32Array; times: Float32Array }>();
  for (const channel of anim.channels) {
    const name = glb.json.nodes[channel.target.node]!.name!, sampler = anim.samplers[channel.sampler]!;
    const entry = channels.get(name) ?? { times: accessor(glb, sampler.input) };
    if (channel.target.path === "translation") entry.position = accessor(glb, sampler.output);
    if (channel.target.path === "rotation") entry.rotation = accessor(glb, sampler.output);
    channels.set(name, entry);
  }
  let millimetres = 0, degrees = 0, at = "";
  native.clip.joints.forEach((joint, i) => {
    const prepared = channels.get(joint);
    if (!prepared) return;
    for (let f = 0; f < Math.min(times.length, prepared.times.length); f++) {
      const o = (f * n + i) * 7;
      if (prepared.position) {
        const d = Math.hypot(local[o]! - prepared.position[f * 3]!, local[o + 1]! - prepared.position[f * 3 + 1]!, local[o + 2]! - prepared.position[f * 3 + 2]!) * 1000;
        if (d > millimetres) { millimetres = d; at = `${joint} frame ${f}`; }
      }
      if (prepared.rotation) { const d = angle(local, o + 3, prepared.rotation, f * 4); if (d > degrees) { degrees = d; if (d > 1e-3) at = `${joint} frame ${f}`; } }
    }
  });
  const preparedFrames = [...channels.values()][0]?.times.length ?? 0;
  return { clip: animation, frames: times.length, preparedFrames, joints: n, preparedJoints: channels.size,
    onlyNative: native.clip.joints.filter(joint => !channels.has(joint)), onlyPrepared: [...channels.keys()].filter(joint => !native.clip.joints.includes(joint)),
    millimetres, degrees, at };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => { const at = args.indexOf(name); return at < 0 ? null : args[at + 1] ?? null; };
  const assets = resolve(flag("--assets") ?? "public/assets"), report = flag("--report");
  const saved = new LocalSettingsStore().load().settings;
  const settings = { gameRoot: packageToolPaths(saved).gamepath, launchRoute: saved.launchRoute, mo2Root: saved.mo2Root, mo2ProfileId: saved.mo2ProfileId,
    manualModRoot: saved.manualModRoot, wolvenKitCli: null };
  const cache = resolve(flag("--cache") ?? join(import.meta.dir, "..", "data", "resolver-cache")), preview = mkdtempSync(join(tmpdir(), "xfs-face-bake-"));
  try {
    const facial = new FacialHost({ cacheRoot: preview, resolverCache: cache, settings: () => settings, solver: () => ({ inProcess: true }), log: message => console.log(`facial: ${message}`) });
    const idles = new IdleHost({ route: () => characterRoute(settings), fingerprint: () => installationFingerprint(settings), resolverCache: preview,
      faces: () => facial.faceSource(), log: message => console.log(`idle: ${message}`) });
    facial.state();
    const rows: ClipComparison[] = [];
    let shapes = { targets: 0, joints: 0, millimetres: 0, degrees: 0, keysDiffer: 0 };
    const blink = await facial.blink();
    if ("reason" in blink) throw Error(blink.reason);
    if (existsSync(join(assets, "game-blink.glb"))) {
      const glb = readGlb(join(assets, "game-blink.glb"));
      for (const clip of blink.clips) rows.push(compareClip({ rest: blink.rest, clip }, glb, clip.name));
      const mine = (blink.description as { shapes?: Record<string, Record<string, number[]>> }).shapes ?? {}, theirs = (glb.json.asset.extras?.shapes ?? {}) as Record<string, Record<string, number[]>>;
      for (const [target, joints] of Object.entries(theirs)) {
        shapes.targets++;
        const own = mine[target] ?? {};
        if (Object.keys(own).sort().join() !== Object.keys(joints).sort().join()) shapes.keysDiffer++;
        for (const [joint, v] of Object.entries(joints)) {
          const m = own[joint]; if (!m) continue; shapes.joints++;
          shapes.millimetres = Math.max(shapes.millimetres, Math.hypot(m[0]! - v[0]!, m[1]! - v[1]!, m[2]! - v[2]!) * 1000);
          shapes.degrees = Math.max(shapes.degrees, angle(m, 3, v, 3));
        }
      }
    }
    const state = await idles.state();
    if (state.phase !== "ready" || state.source !== "game") throw Error(`The idles aren't ready: ${state.phase}`);
    if (state.faceReason) console.log(`idle faces: ${state.faceReason}`);
    console.log(`idle entries: ${state.catalogue.idles.map(entry => `${entry.id}=${entry.face?.clip ?? "-"}`).join(", ")}`);
    const prepared = new Map([["closeup", "cc-idle-face.glb"], ["closeup-eyes", "cc-idle-face-eyes-section.glb"], ["fullbody", "cc-idle-face-ui_fullbody_shot.glb"]]);
    for (const entry of state.catalogue.idles) {
      if (!entry.face) continue;
      const started = performance.now(), record = await idles.face(entry.id);
      console.log(`${entry.id}: ${entry.face.clip} baked in ${Math.round(performance.now() - started)} ms`);
      const file = prepared.get(entry.id);
      if (record && file && existsSync(join(assets, file))) rows.push(compareClip(record, readGlb(join(assets, file)), `${entry.face.clip}_face`));
    }
    for (const row of rows) console.log(`${row.clip}: ${row.frames}/${row.preparedFrames} frames, ${row.joints}/${row.preparedJoints} joints (only native ${row.onlyNative.length}, only prepared ${row.onlyPrepared.length}); max ${row.millimetres.toExponential(2)} mm, ${row.degrees.toExponential(2)}° at ${row.at}`);
    console.log(`eye shapes: ${shapes.targets} targets, ${shapes.joints} joints, joint sets differ in ${shapes.keysDiffer}; max ${shapes.millimetres.toExponential(2)} mm, ${shapes.degrees.toExponential(2)}°`);
    if (report) writeFileSync(report, JSON.stringify({ tool: "facial-bake-oracle", rows, shapes }, null, 2) + "\n");
    facial.dispose();
  } finally { rmSync(preview, { recursive: true, force: true }); }
}
