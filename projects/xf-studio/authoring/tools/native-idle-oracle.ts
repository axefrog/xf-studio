/**
 * Oracle for the native body idle (idle-host.ts; knowledge/body-animation.md §2): reads the game's preview idles with XF Studio's own reader
 * and compares them with the developer preparation's files (the Python `tools/prepare_idle.py` and `prepare_body_idles.py`, which export
 * each clip through WolvenKit's animation exporter): the catalogue entry by entry, every idle's skeleton at rest, every frame of every
 * joint channel, the joints' world positions and rotations over the whole clip, and the head joints' ancestry. Read-only towards the game.
 *
 *   bun tools/native-idle-oracle.ts --game <game folder> --assets <folder with cc-idle-*.glb, cc-idle-catalogue.json, cc-idle-binding.json>
 *     [--mo2 <MO2 root> --profile <profile>] [--cache <resolver cache>] [--report <file>]
 *
 * Run it under tools/memory_guard.py. The opt-in test `tests/native-idle-oracle.test.ts` runs the same comparison.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { idleCatalogue, rigAncestry, type RestJoint } from "../src/idle-body";
import { parseIdleCatalogue, type IdleEntry } from "../src/idle-catalogue";
import { idleSample, readIdles } from "../src/idle-host";
import { clipSampler } from "../src/native/anim-set";
import type { Installation } from "../src/resolver-host";
import { rotationToGltf, scaleToGltf, translationToGltf } from "../src/pose-clip";


type Glb = { json: { nodes: { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  animations: { name: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number }[] }[];
  accessors: { bufferView: number; byteOffset?: number; count: number; type: string }[]; bufferViews: { byteOffset?: number }[] }; bin: Buffer };
function readGlb(file: string): Glb {
  const b = readFileSync(file), length = b.readUInt32LE(12);
  return { json: JSON.parse(b.subarray(20, 20 + length).toString()), bin: b.subarray(20 + length + 8) };
}
function accessor(glb: Glb, index: number): Float32Array {
  const a = glb.json.accessors[index]!, view = glb.json.bufferViews[a.bufferView]!, width = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type]!;
  const start = glb.bin.byteOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return new Float32Array(glb.bin.buffer.slice(start, start + a.count * width * 4));
}

/** The angle between two rotations, in degrees (from the relative rotation's vector part, which stays accurate near zero). */
const angle = (a: THREE.Quaternion, b: THREE.Quaternion) => {
  const d = a.clone().invert().multiply(b);
  return 2 * Math.atan2(Math.hypot(d.x, d.y, d.z), Math.abs(d.w)) * 180 / Math.PI;
};
const maxAbs = (a: ArrayLike<number>, b: ArrayLike<number>) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!)); return m; };
const quatDiff = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.min(maxAbs(a, b), maxAbs(a, Array.from(b, v => -v)));

export type IdleComparison = {
  catalogue: { entries: number; differences: string[]; left: { native: string[]; prepared: string[] } };
  ancestry: { joints: number; differences: string[] };
  clips: { clip: string; buffer: string; frames: number; preparedFrames: number; keys: number; restTranslation: number; restRotation: number; restScale: number;
    channels: number; translation: number; rotation: number; scale: number; worldMillimetres: number; worldDegrees: number; worldAt: string }[];
};

/** Compose each frame's world transforms from per-joint local TRS (glTF axes) through the parents. */
function worlds(joints: readonly { bone: string; parent: string | null }[], local: (bone: string) => THREE.Matrix4) {
  const out = new Map<string, THREE.Matrix4>();
  for (const joint of joints) out.set(joint.bone, (joint.parent ? out.get(joint.parent)!.clone() : new THREE.Matrix4()).multiply(local(joint.bone)));
  return out;
}

export async function compareIdles(installation: Installation, assets: string): Promise<IdleComparison> {
  const idles = await readIdles(installation);
  const prepared = parseIdleCatalogue(JSON.parse(readFileSync(resolve(assets, "cc-idle-catalogue.json"), "utf8")));
  const faces = new Map<string, IdleEntry>(prepared.idles.filter(entry => entry.face).map(entry => [entry.id, entry]));
  const native = idleCatalogue({ entries: idles.entries, left: idles.left, durations: new Map(Object.entries(idles.durations)), source: idles.source, faces });
  const differences: string[] = [];
  const fields = ["id", "label", "clip", "body", "duration", "screen", "state", "flags", "face", "puppet", "evidence"] as const;
  for (const [i, want] of prepared.idles.entries()) {
    const got = native.idles[i];
    if (!got) { differences.push(`${want.id}: missing`); continue; }
    for (const field of fields) if (JSON.stringify(got[field]) !== JSON.stringify(want[field])) differences.push(`${want.id}.${field}: ${JSON.stringify(got[field])} ≠ ${JSON.stringify(want[field])}`);
  }
  if (native.idles.length !== prepared.idles.length) differences.push(`${native.idles.length} entries ≠ ${prepared.idles.length}`);
  if (JSON.stringify(native.source) !== JSON.stringify(prepared.source)) differences.push(`source: ${JSON.stringify(native.source)} ≠ ${JSON.stringify(prepared.source)}`);
  const binding = JSON.parse(readFileSync(resolve(assets, "cc-idle-binding.json"), "utf8")) as { ancestry: Record<string, string | null> };
  const ancestry = rigAncestry(idles.face?.joints ?? []), ancestryDifferences: string[] = [];
  for (const name of new Set([...Object.keys(ancestry), ...Object.keys(binding.ancestry)]))
    if (ancestry[name] !== binding.ancestry[name]) ancestryDifferences.push(`${name}: ${ancestry[name]} ≠ ${binding.ancestry[name]}`);
  const decode = installation.fetcher.nativeDecoder!.decodeAnim!.bind(installation.fetcher.nativeDecoder);
  const clips: IdleComparison["clips"] = [];
  for (const clipName of [...new Set(prepared.idles.map(entry => entry.clip))]) {
    const entry = prepared.idles.find(item => item.clip === clipName)!, source = idles.clips[clipName];
    if (!source || !existsSync(resolve(assets, entry.body))) continue;
    const [clipOutcome, rigOutcome] = await Promise.all([decode({ archivePath: source.archive, hash: source.setHash, op: "clip", clip: clipName }),
      decode({ archivePath: source.rigArchive, hash: source.rigHash, op: "rig" })]);
    if (!clipOutcome.ok || !clipOutcome.clip || !rigOutcome.ok || !rigOutcome.rig) throw Error(`${clipName} couldn't be decoded natively.`);
    const sample = idleSample(entry.id, clipOutcome.clip, rigOutcome.rig, source);
    const glb = readGlb(resolve(assets, entry.body)), animation = glb.json.animations.find(a => a.name === clipName) ?? glb.json.animations[0]!;
    // Rest: the native skeleton (rig A pose) against the export's nodes.
    const rest = new Map<string, RestJoint>(idles.rig.joints.map(joint => [joint.bone, joint]));
    let restTranslation = 0, restRotation = 0, restScale = 0;
    for (const node of glb.json.nodes) {
      const joint = node.name ? rest.get(node.name) : undefined;
      if (!joint) continue;
      restTranslation = Math.max(restTranslation, maxAbs(translationToGltf(joint.translation), node.translation ?? [0, 0, 0]));
      restRotation = Math.max(restRotation, quatDiff(rotationToGltf(joint.rotation), node.rotation ?? [0, 0, 0, 1]));
      restScale = Math.max(restScale, maxAbs(scaleToGltf(joint.scale), node.scale ?? [1, 1, 1]));
    }
    // The export's channels: WolvenKit writes one sampler per keyed joint channel, at that channel's key times (every frame of a SIMD clip).
    const exported = new Map<string, { times: Float32Array; values: Float32Array }>();
    let preparedFrames = 0;
    for (const channel of animation.channels) {
      const node = glb.json.nodes[channel.target.node]!, sampler = animation.samplers[channel.sampler]!;
      const times = accessor(glb, sampler.input);
      preparedFrames = Math.max(preparedFrames, times.length);
      exported.set(`${node.name}|${channel.target.path}`, { times, values: accessor(glb, sampler.output) });
    }
    const nodeRest = new Map(glb.json.nodes.map(node => [node.name, node] as const));
    /** The export at a time, as the page's mixer plays it: linear between keys (slerp for rotations), the node's rest where unkeyed. */
    const exportAt = (bone: string, path: "translation" | "rotation" | "scale", t: number): number[] => {
      const found = exported.get(`${bone}|${path}`), width = path === "rotation" ? 4 : 3;
      if (!found) { const node = nodeRest.get(bone); return [...(node?.[path] ?? (path === "rotation" ? [0, 0, 0, 1] : path === "scale" ? [1, 1, 1] : [0, 0, 0]))]; }
      const { times, values } = found;
      let next = 0;
      while (next < times.length && times[next]! < t) next++;
      if (next === 0 || next >= times.length) { const i = Math.min(next, times.length - 1); return Array.from(values.subarray(i * width, i * width + width)); }
      const f = (t - times[next - 1]!) / (times[next]! - times[next - 1]!);
      const a = values.subarray((next - 1) * width, next * width), b = values.subarray(next * width, (next + 1) * width);
      if (path !== "rotation") return Array.from(a, (v, i) => v + (b[i]! - v) * f);
      const q = new THREE.Quaternion(...a).slerp(new THREE.Quaternion(...b), f);
      return [q.x, q.y, q.z, q.w];
    };
    // Each exported key against the native decoder sampled at the key's time (game space into glTF axes, as the export converts).
    const sampleAt = clipSampler(clipOutcome.clip), boneIndex = new Map(rigOutcome.rig.bones.map((bone, i) => [bone, i] as const));
    let translation = 0, rotation = 0, scale = 0, keys = 0;
    for (const [key, { times, values }] of exported) {
      const [bone, path] = key.split("|") as [string, "translation" | "rotation" | "scale"];
      const index = boneIndex.get(bone);
      if (index === undefined) continue;
      const width = path === "rotation" ? 4 : 3, reference = rigOutcome.rig.reference[index]!;
      for (let k = 0; k < times.length; k++) {
        const joint = sampleAt(times[k]!).joints.get(index), want = values.subarray(k * width, k * width + width);
        keys++;
        if (path === "rotation") rotation = Math.max(rotation, quatDiff(rotationToGltf(joint?.rotation ?? reference.rotation), want));
        else if (path === "translation") translation = Math.max(translation, maxAbs(translationToGltf(joint?.translation ?? reference.translation), want));
        else scale = Math.max(scale, maxAbs(scaleToGltf(joint?.scale ?? reference.scale), want));
      }
    }
    // World positions and rotations of every joint at every frame the page plays: the native sample's frames against the export played at
    // the same times.
    const moving = new Map((sample.motion?.channels ?? []).map(channel => [`${channel.bone}|${channel.channel}`, channel.values]));
    const held = new Map(sample.joints.map(joint => [joint.bone, joint]));
    const frames = sample.motion?.frames ?? 1, rate = sample.motion?.rate ?? 1;
    const nativeValue = (bone: string, channel: "translation" | "rotation" | "scale", frame: number): number[] => {
      const width = channel === "rotation" ? 4 : 3, values = moving.get(`${bone}|${channel}`);
      const raw = values ? values.slice(frame * width, frame * width + width) : held.get(bone)![channel];
      return channel === "rotation" ? rotationToGltf(raw) : channel === "translation" ? translationToGltf(raw) : scaleToGltf(raw);
    };
    const joints = idles.rig.joints;
    const local = (value: (bone: string, path: "translation" | "rotation" | "scale") => number[]) => (bone: string) =>
      new THREE.Matrix4().compose(new THREE.Vector3(...value(bone, "translation")), new THREE.Quaternion(...value(bone, "rotation")), new THREE.Vector3(...value(bone, "scale")));
    let worldMillimetres = 0, worldDegrees = 0, worldAt = "";
    const a = new THREE.Vector3(), b = new THREE.Vector3(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), s = new THREE.Vector3();
    for (let f = 0; f < frames; f++) {
      const got = worlds(joints, local((bone, path) => nativeValue(bone, path, f))), want = worlds(joints, local((bone, path) => exportAt(bone, path, f / rate)));
      for (const joint of joints) {
        got.get(joint.bone)!.decompose(a, qa, s); want.get(joint.bone)!.decompose(b, qb, s);
        const mm = a.distanceTo(b) * 1000, deg = angle(qa, qb);
        if (mm > worldMillimetres) { worldMillimetres = mm; worldAt = `${joint.bone} @ ${(f / rate).toFixed(3)} s`; }
        worldDegrees = Math.max(worldDegrees, deg);
      }
    }
    clips.push({ clip: clipName, buffer: clipOutcome.clip.buffer ?? "", frames, preparedFrames, keys, restTranslation, restRotation, restScale, channels: exported.size,
      translation, rotation, scale, worldMillimetres, worldDegrees, worldAt });
  }
  return { catalogue: { entries: native.idles.length, differences, left: { native: native.left.map(item => item.clip), prepared: prepared.left.map(item => item.clip) } },
    ancestry: { joints: Object.keys(binding.ancestry).length, differences: ancestryDifferences }, clips };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  const game = option("game"), assets = option("assets");
  if (!game || !assets) { console.error("usage: bun tools/native-idle-oracle.ts --game <folder> --assets <folder> [--mo2 <root> --profile <id>] [--cache <dir>] [--report <file>]"); process.exit(2); }
  const { installations } = await import("../src/installation-registry");
  const cacheDir = resolve(option("cache") ?? resolve(import.meta.dir, "..", "data", "resolver-cache"));
  const started = performance.now();
  const installation = await installations.acquire({ gameRoot: resolve(game), wolvenKitCli: null, launchRoute: option("mo2") ? "mo2" : "direct",
    mo2Root: option("mo2") ? resolve(option("mo2")!) : null, mo2ProfileId: option("profile") ?? null, manualModRoot: null, cacheDir,
    log: (line: string) => console.error(line) });
  const opened = performance.now();
  const report = await compareIdles(installation, resolve(assets));
  const summary = { ...report, timings: { openMs: Math.round(opened - started), compareMs: Math.round(performance.now() - opened) } };
  console.log(JSON.stringify(summary, null, 1));
  if (option("report")) writeFileSync(option("report")!, JSON.stringify(summary, null, 2) + "\n");
  installations.clear?.();
  process.exit(0);
}
