/**
 * Host service for the game's character-preview idles (idle-body.ts), shared by localhost and the desktop: it reads them from the player's
 * own game files with XF Studio's native reader, so neither host needs Python or WolvenKit for V's body idle (knowledge/body-animation.md
 * §2). Read-only towards the game and the mod manager. What it reads, the way the game finds it:
 *
 * - **Puppet**: the third-person player entity (`PLAYER_ENTITIES`, the creator's and the inventory's preview puppet) with every ArchiveXL
 *   patch of it; its `root` animated component's body graph (`player_paperdoll.animgraph`), and the animation sets of that component and
 *   its animation-setup extension components, then the `.xl` `animations:` entries for `root` of that entity (pose-catalogue-host.ts
 *   `entitySets`, the same rule).
 * - **Idles**: the graph's looping clips per screen (`previewIdles`); each clip from the first set that holds it, with its length.
 * - **Rigs**: the set's rig (`woman_base.rig`) for the skeleton the clips play on, and the face skeleton (`FACE_SKELETON`) for the head
 *   joints' ancestry.
 * - **Bodies**: a clip decoded on demand (SIMD for the preview idles) and sampled at every frame into a `xfs/pose-sample-1` record.
 *
 * Everything read is cached on disk under `<resolver cache>/idles/`, keyed by the installation's fingerprint and the readers' versions, so a
 * later start answers without opening the route. A developer preparation (Python, `tools/prepare_body_idles.py`) is used only as the oracle
 * (`source: "prepared"`) or for the face clips it baked, which the app can't make yet.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { PLAYER_ENTITIES } from "./clothing-resolver";
import { animatedComponents } from "./deformation-rig-host";
import { writeFileAtomic } from "./derived-cache";
import { depotHash, refFromHash, refFromPath } from "./depot-path";
import { FACE_SKELETON } from "./facial-catalogue";
import { BUILT_IN_CATALOGUE, parseIdleCatalogue, type IdleCatalogue, type IdleEntry } from "./idle-catalogue";
import { IDLE_STATE_SCHEMA, idleCatalogue, previewIdles, restJoints, rigAncestry, type GraphIdle, type IdleState, type RestJoint } from "./idle-body";
import { ANIM_DECODER_VERSION, clipSampler, type AnimClip, type AnimRig, type AnimSetIndex } from "./native/anim-set";
import type { NativeAnimOutcome, NativeAnimRequest } from "./native/anim-decode";
import { clipMotion, entitySets, type PoseRoute } from "./pose-catalogue-host";
import { POSE_SAMPLE_SCHEMA } from "./pose-catalogue";
import type { PoseSample } from "./pose-sample";
import { packageChunks, type JsonObject } from "./red-json";
import type { Installation, InstallationOptions } from "./resolver-host";

/** Version of what this host derives (the catalogue rule, the sample's shape); part of the disk cache's key with the decoder's. */
export const IDLE_HOST_VERSION = 1;
const NEEDS_SETUP = "V's idle comes from your game. Choose your game folder in Settings › Game.";
const PREPARING = "Reading the character creator's idle from your game…";
const FAILED = "XF Studio couldn't read the character creator's idle from your game, so V holds still. Everything else works.";

/** Asked for the idles before the game folder is set up. */
export class IdleSetupError extends Error { constructor() { super(NEEDS_SETUP); } }

type AnimDecoder = (request: NativeAnimRequest) => Promise<NativeAnimOutcome>;
/** Where a catalogue entry's clip lives: the set's winning archive and hash, and the set's rig. */
type ClipSource = { archive: string; set: string; setHash: string; clip: string; rigArchive: string; rigHash: string; rigPath: string };
/** What the build reads from the game, as cached on disk (the prepared faces are joined when answering). */
type NativeIdles = { entries: GraphIdle[]; left: { clip: string; why: string }[]; durations: Record<string, number>; source: IdleCatalogue["source"];
  rig: { path: string; joints: RestJoint[] }; face: { path: string; joints: RestJoint[] } | null; clips: Record<string, ClipSource> };

export type IdleHostOptions = {
  /** The launch route (WolvenKit optional), or null while the game folder isn't set up. */
  route: () => PoseRoute | null;
  /** The installation fingerprint (character-detail-host.ts `installationFingerprint`). */
  fingerprint: () => string;
  resolverCache: string;
  open?: (options: InstallationOptions) => Installation | Promise<Installation>;
  /**
   * The developer preparation's asset folder (localhost's `public/assets`), or null: the desktop has none, and `XFS_PREPARED_MOTION=off`
   * makes localhost behave the same. Its baked face clips join the entries they belong to.
   */
  preparedAssets?: () => string | null;
  /** `prepared` answers with the developer preparation alone (the Python oracle, `XFS_IDLE_SOURCE=prepared`); `game` (default) reads the game. */
  source?: "game" | "prepared";
  log?: (message: string) => void;
};

const readJson = (path: string): unknown => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } };

/** The entity's animation sets: `entitySets` over its inline components and its compiled package's. */
function puppetSets(entity: JsonObject): { path: string | null; hash: string }[] {
  const compiled = packageChunks(entity.compiledData);
  return [...entitySets({ components: compiled }), ...entitySets(entity)].map(set => ({ path: set.path, hash: set.hash }));
}

/** Installation keys the idle cache keeps (PREV-163): a verification server borrowing the resolver cache and the main server both keep theirs. */
export const IDLE_CACHE_KEYS = 4;
/** Drop the idle cache's least recently used installation folders beyond `keep`, never `kept` (the one just written). */
export function pruneIdleCache(root: string, kept: string, keep = IDLE_CACHE_KEYS): void {
  let names: string[];
  try { names = readdirSync(root); } catch { return; }
  const aged = names.filter(name => name !== kept)
    .map(name => { try { return { name, at: statSync(join(root, name)).mtimeMs }; } catch { return null; } })
    .filter((item): item is { name: string; at: number } => !!item).sort((a, b) => b.at - a.at);
  for (const item of aged.slice(Math.max(0, keep - 1))) rmSync(join(root, item.name), { recursive: true, force: true });
}

export class IdleHost {
  private entry: { key: string; promise: Promise<NativeIdles>; done: NativeIdles | null; error: string | null } | null = null;
  private readonly bodies = new Map<string, Promise<PoseSample | null>>();
  constructor(private readonly options: IdleHostOptions) {}

  private cacheDir(key: string) { return join(this.options.resolverCache, "idles", key); }
  private key(): string {
    return createHash("sha256").update(`${IDLE_HOST_VERSION}|${ANIM_DECODER_VERSION}|${this.options.fingerprint()}`).digest("hex").slice(0, 32);
  }

  /** The developer preparation's catalogue (null when there is none or it can't be read). */
  private prepared(): { dir: string; catalogue: IdleCatalogue } | null {
    const dir = this.options.preparedAssets?.() ?? null;
    if (!dir) return null;
    const value = readJson(join(dir, "cc-idle-catalogue.json"));
    try { if (value) return { dir, catalogue: parseIdleCatalogue(value) }; } catch { return null; }
    return existsSync(join(dir, "cc-idle-body.glb")) ? { dir, catalogue: BUILT_IN_CATALOGUE } : null;
  }

  /** Read the idles from the game (or the disk cache), once per installation fingerprint. */
  private ensure(): Promise<NativeIdles> {
    const route = this.options.route();
    if (!route) return Promise.reject(new IdleSetupError());
    const key = this.key();
    if (this.entry?.key === key && !this.entry.error) return this.entry.promise;
    const entry = { key, promise: null as unknown as Promise<NativeIdles>, done: null as NativeIdles | null, error: null as string | null };
    this.bodies.clear();
    entry.promise = (async () => {
      const file = join(this.cacheDir(key), "idles.json");
      const cached = readJson(file) as { version?: number; idles?: NativeIdles } | null;
      if (cached?.version === IDLE_HOST_VERSION && cached.idles) {
        // Used: its age starts again, so another installation's writes keep it (PREV-163).
        try { const now = new Date(); utimesSync(this.cacheDir(key), now, now); } catch { /* Advisory. */ }
        return cached.idles;
      }
      const started = performance.now();
      const open = this.options.open ?? (await import("./installation-registry")).acquireInstallation;
      const installation = await open({ ...route, cacheDir: this.options.resolverCache, log: this.options.log });
      const idles = await readIdles(installation, this.options.log);
      this.options.log?.(`Idles read from the game in ${((performance.now() - started) / 1000).toFixed(1)} s: ${idles.entries.map(e => e.clip).join(", ")}.`);
      try {
        // One cache folder per installation; the few most recently used are kept (another host sharing the resolver cache keeps its own).
        mkdirSync(this.cacheDir(key), { recursive: true });
        pruneIdleCache(join(this.options.resolverCache, "idles"), key);
        writeFileAtomic(file, JSON.stringify({ version: IDLE_HOST_VERSION, idles }));
      } catch { /* Advisory: read again next time. */ }
      return idles;
    })();
    entry.promise.then(done => { entry.done = done; }, error => {
      entry.error = (error as Error)?.message ?? String(error);
      if (!(error instanceof IdleSetupError)) this.options.log?.(`The idles were not read: ${(error as Error)?.stack ?? error}`);
    });
    this.entry = entry;
    return entry.promise;
  }

  /** The idles' state, waiting for them to be read (never throws: a failure is a plain state). */
  async state(): Promise<IdleState> {
    if (this.options.source === "prepared") {
      const prepared = this.prepared();
      return prepared ? { schema: IDLE_STATE_SCHEMA, phase: "ready", message: "", source: "prepared", catalogue: prepared.catalogue }
        : { schema: IDLE_STATE_SCHEMA, phase: "failed", message: FAILED };
    }
    if (!this.options.route()) return { schema: IDLE_STATE_SCHEMA, phase: "needs-setup", message: NEEDS_SETUP };
    let idles: NativeIdles;
    try { idles = await this.ensure(); } catch (error) {
      return error instanceof IdleSetupError ? { schema: IDLE_STATE_SCHEMA, phase: "needs-setup", message: NEEDS_SETUP }
        : { schema: IDLE_STATE_SCHEMA, phase: "failed", message: FAILED };
    }
    // A prepared face joins its entry only while its file is there.
    const prepared = this.prepared(), faces = new Map<string, IdleEntry>();
    if (prepared) for (const entry of prepared.catalogue.idles) if (entry.face && existsSync(join(prepared.dir, entry.face.file))) faces.set(entry.id, entry);
    const catalogue = idleCatalogue({ entries: idles.entries, left: idles.left, durations: new Map(Object.entries(idles.durations)), source: idles.source, faces });
    return { schema: IDLE_STATE_SCHEMA, phase: "ready", message: "", source: "game", catalogue, rig: idles.rig,
      ancestry: rigAncestry(idles.face?.joints ?? idles.rig.joints), face: idles.face };
  }

  /** Forget what was read (the cache was cleared): the next question reads the game again. */
  forget() { this.entry = null; this.bodies.clear(); }

  /** The state without waiting: what a status line shows. */
  peek(): IdleState {
    if (!this.options.route()) return { schema: IDLE_STATE_SCHEMA, phase: "needs-setup", message: NEEDS_SETUP };
    if (this.entry?.error) return { schema: IDLE_STATE_SCHEMA, phase: "failed", message: FAILED };
    return { schema: IDLE_STATE_SCHEMA, phase: "preparing", message: PREPARING };
  }

  /** One idle's body clip at every frame, on its rig (`xfs/pose-sample-1` with `motion`); null when the idle or its clip can't be read. */
  body(id: string): Promise<PoseSample | null> {
    let pending = this.bodies.get(id);
    if (!pending) {
      pending = this.readBody(id);
      pending.catch(() => this.bodies.delete(id));
      this.bodies.set(id, pending);
    }
    return pending;
  }

  private async readBody(id: string): Promise<PoseSample | null> {
    const idles = await this.ensure(), key = this.entry!.key;
    const entry = idles.entries.find(candidate => candidate.id === id) ?? (id === "closeup-eyes" ? idles.entries.find(candidate => candidate.id === "closeup") : undefined);
    const source = entry ? idles.clips[entry.clip] : undefined;
    if (!entry || !source) return null;
    const file = join(this.cacheDir(key), `body-${entry.clip.toLowerCase()}.json`);
    const cached = readJson(file) as PoseSample | null;
    if (cached && cached.schema === POSE_SAMPLE_SCHEMA && cached.clip?.name === entry.clip) return { ...cached, id };
    const route = this.options.route();
    if (!route) throw new IdleSetupError();
    const open = this.options.open ?? (await import("./installation-registry")).acquireInstallation;
    const installation = await open({ ...route, cacheDir: this.options.resolverCache, log: this.options.log });
    const decode = decoderOf(installation);
    if (!decode) throw Error("XF Studio's reader for game files isn't running.");
    const [clipOutcome, rigOutcome] = await Promise.all([decode({ archivePath: source.archive, hash: source.setHash, op: "clip", clip: source.clip }),
      decode({ archivePath: source.rigArchive, hash: source.rigHash, op: "rig" })]);
    if (!clipOutcome.ok || !clipOutcome.clip) throw Error(`${source.clip} couldn't be decoded: ${clipOutcome.ok ? "not in its set" : `${clipOutcome.kind}: ${clipOutcome.message}`}`);
    if (!rigOutcome.ok || !rigOutcome.rig) throw Error(`${source.rigPath} couldn't be read: ${rigOutcome.ok ? "no rig" : `${rigOutcome.kind}: ${rigOutcome.message}`}`);
    const sample = idleSample(id, clipOutcome.clip, rigOutcome.rig, source);
    try { mkdirSync(this.cacheDir(key), { recursive: true }); writeFileAtomic(file, JSON.stringify(sample)); } catch { /* Advisory. */ }
    return sample;
  }
}

const decoderOf = (installation: Installation): AnimDecoder | null => {
  const decoder = installation.fetcher.nativeDecoder;
  return decoder?.decodeAnim ? request => decoder.decodeAnim!(request) : null;
};

/** An idle's body clip as a moving pose's sample: every joint's value at 0 s (the rig's reference where unkeyed) and every frame of the rest. */
export function idleSample(id: string, clip: AnimClip, rig: AnimRig, source: { set: string; rigPath: string }): PoseSample {
  const first = clipSampler(clip)(0);
  const joints = rig.bones.map((bone, index) => {
    const keyed = first.joints.get(index), reference = rig.reference[index]!;
    return { bone, parent: rig.parents[index]! >= 0 ? rig.bones[rig.parents[index]!]! : null, translation: [...(keyed?.translation ?? reference.translation)],
      rotation: [...(keyed?.rotation ?? reference.rotation)], scale: [...(keyed?.scale ?? reference.scale)], keyed: !!keyed };
  });
  const tracks: Record<string, number> = {};
  for (const [index, value] of first.tracks) tracks[rig.tracks[index] ?? `track${index}`] = value;
  const motion = clipMotion(clip, rig);
  return { schema: POSE_SAMPLE_SCHEMA, id, clip: { name: clip.name, set: source.set, frames: clip.frames, duration: clip.duration }, time: 0, rig: source.rigPath,
    joints, tracks, ...(motion ? { motion } : {}) };
}

/** Read the idles from an opened installation. Throws with a technical reason (logged; the page words it plainly). */
export async function readIdles(installation: Installation, log?: (message: string) => void): Promise<NativeIdles> {
  const graph = installation.graph, decode = decoderOf(installation);
  if (!decode) throw Error("XF Studio's reader for game files isn't running.");
  const ref = refFromPath(PLAYER_ENTITIES.female);
  const entity = await graph.load(ref, "ent");
  if (!entity) throw Error(`${PLAYER_ENTITIES.female} couldn't be read.`);
  // The entity and its ArchiveXL patches: a later `root` wins, sets add up in order.
  const roots: JsonObject[] = [entity.root];
  for (const patch of graph.patchesFor(ref.hash)) {
    const source = await graph.load(refFromHash(patch.source, patch.sourcePath), "ent");
    if (source) roots.push(source.root);
  }
  const root = roots.flatMap(r => animatedComponents(r)).filter(component => component.name === "root" && component.graph).at(-1);
  if (!root?.graph) throw Error("The player entity has no root animated component with a graph.");
  const graphRef = /^[0-9]+$/.test(root.graph) ? refFromHash(root.graph) : refFromPath(root.graph);
  // The body graph holds curves the reader doesn't decode (blend curves); only its nodes, names and clip references are needed, so it is
  // read leniently, leaving those properties out.
  const graphArchive = graph.lookup(graphRef.hash).winner, documents = installation.fetcher.nativeDecoder;
  if (!graphArchive || !documents) throw Error(`${root.graph} isn't in the game's archives, or the reader isn't running.`);
  const graphOutcome = await documents.decode({ archivePath: graphArchive.id, hash: graphRef.hash, needName: false, lenient: true, maxDepth: 4096, timeoutMs: 30_000 });
  const graphRoot = graphOutcome.ok ? (graphOutcome.document as { Data?: { RootChunk?: JsonObject } }).Data?.RootChunk : undefined;
  if (!graphRoot) throw Error(`${root.graph} couldn't be read: ${graphOutcome.ok ? "no root" : `${graphOutcome.kind}: ${graphOutcome.message}`}`);
  const { entries, left } = previewIdles(graphRoot);
  if (!entries.length) throw Error(`${root.graph} names no looping preview clip.`);
  const declared = roots.flatMap(puppetSets);
  for (const xl of installation.xl.animations) if (xl.component === "root" && xl.targets.has(ref.hash)) declared.push({ path: xl.set, hash: xl.setHash });
  // Each set's clip index, in order, until every idle's clip is found.
  const clips: Record<string, ClipSource> = {}, durations: Record<string, number> = {};
  const wanted = new Set(entries.map(entry => entry.clip));
  let setPath: string | null = null;
  for (const set of [...new Map(declared.map(item => [item.hash, item] as const)).values()]) {
    if (![...wanted].some(clip => !clips[clip])) break;
    const archive = graph.lookup(set.hash).winner;
    if (!archive) continue;
    const outcome = await decode({ archivePath: archive.id, hash: set.hash, op: "index" });
    if (!outcome.ok || !outcome.index) { log?.(`Animation set ${set.path ?? set.hash} couldn't be read: ${outcome.ok ? "no index" : outcome.message}`); continue; }
    const index: AnimSetIndex = outcome.index;
    if (!index.rig) continue;
    const rigHash = depotHash(index.rig), rigArchive = graph.lookup(rigHash).winner;
    if (!rigArchive) continue;
    for (const info of index.clips) {
      if (!wanted.has(info.name) || clips[info.name] || (info.buffer !== "simd" && info.buffer !== "compressed")) continue;
      const path = set.path ?? graph.named(refFromHash(set.hash)).path ?? `#${set.hash}`;
      clips[info.name] = { archive: archive.id, set: path, setHash: set.hash, clip: info.name, rigArchive: rigArchive.id, rigHash, rigPath: index.rig };
      durations[info.name] = info.duration;
      setPath ??= path;
    }
  }
  const found = entries.filter(entry => clips[entry.clip]);
  if (!found.length) throw Error("None of the preview idles' clips is in the puppet's animation sets.");
  const first = clips[found[0]!.clip]!;
  const rigOutcome = await decode({ archivePath: first.rigArchive, hash: first.rigHash, op: "rig" });
  if (!rigOutcome.ok || !rigOutcome.rig) throw Error(`${first.rigPath} couldn't be read.`);
  // The face skeleton: its joints follow `Head` through their own parents (the head's bones the body clips don't drive).
  let face: NativeIdles["face"] = null;
  const faceRef = refFromPath(FACE_SKELETON), faceArchive = graph.lookup(faceRef.hash).winner;
  if (faceArchive) {
    const outcome = await decode({ archivePath: faceArchive.id, hash: faceRef.hash, op: "rig" });
    if (outcome.ok && outcome.rig) face = { path: FACE_SKELETON, joints: restJoints(outcome.rig) };
    else log?.(`The face skeleton couldn't be read, so the head's joints follow the nearest body joint: ${outcome.ok ? "no rig" : outcome.message}`);
  }
  return { entries: found, left, durations, source: { graph: graph.named(graphRef).path ?? root.graph, set: setPath ?? "", rig: first.rigPath },
    rig: { path: first.rigPath, joints: restJoints(rigOutcome.rig) }, face, clips };
}

/** The idles' cache as "Clear prepared game files" counts and clears it (character-detail-host.ts `attachPrepared`). */
export function idlePrepared(host: IdleHost, resolverCache: string) {
  const root = join(resolverCache, "idles");
  const size = (dir: string): number => {
    let total = 0;
    try { for (const entry of readdirSync(dir, { withFileTypes: true })) total += entry.isDirectory() ? size(join(dir, entry.name)) : statSync(join(dir, entry.name)).size; }
    catch { /* Gone meanwhile. */ }
    return total;
  };
  return {
    bytes: async () => size(root),
    clear: async () => { const freed = size(root); rmSync(root, { recursive: true, force: true }); host.forget(); return { freed }; },
  };
}
