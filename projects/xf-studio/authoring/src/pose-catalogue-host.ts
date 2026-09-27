/**
 * Host service for the photo-mode pose catalogue (pose-catalogue.ts), shared by localhost and the desktop. It opens the launch route
 * through the shared installation registry, reads what the game reads, and keeps one catalogue per body gender while the mod setup is
 * unchanged (the installation fingerprint and the game's on-screen language are its key). Read-only towards the game and the mod manager.
 *
 * - **TweakDB**: `r6\cache\tweakdb_ep1.bin` with Phantom Liberty, else `tweakdb.bin` (as the creator catalogue reads it), and the TweakXL
 *   overlay of the route's `r6/tweaks` files (cc-catalogue-host.ts `installedTweakOverlay`).
 * - **Puppet**: `Character.Player_Puppet_Photomode.genders`, the entry whose `gender` is the body gender, its `entity` [resource].
 * - **Sets**: the puppet's `root` animated component and its animation-setup extension components (`animations.gameplay`), then the `.xl`
 *   `animations:` entries whose targets hold the puppet's template and whose component is `root`, in load order, each dropped when no
 *   archive holds it (ArchiveXL Configure) [source: ArchiveXL `Animation/Extension.cpp`]. That the extension components add to `root`'s
 *   lookup is [hypothesis]; the vanilla pose sets are listed there.
 * - **Clip names**: each set's index (anim-set.ts) through the route's native decoder, at background priority, cached on disk under
 *   `<resolver cache>/poses/` by the winning archive's identity (path, size, time), the set's hash and the decoder version, so only changed
 *   archives are read again. Listing decodes no clip.
 * - **Samples**: a pose's clip decoded on demand (the same decoder), sampled at its `animationTime`, with the rig's bone names; decoded
 *   clips are kept in memory by archive identity.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { MountedArchive } from "./archive-precedence";
import { currentGameLanguage, installedTweakOverlay, loadTextTable } from "./cc-catalogue-host";
import { writeFileAtomic } from "./derived-cache";
import { depotHash, refFromHash } from "./depot-path";
import { ANIM_DECODER_VERSION, type AnimClip, type AnimRig, type AnimSetIndex, sampleClip } from "./native/anim-set";
import type { NativeAnimOutcome, NativeAnimRequest } from "./native/anim-decode";
import { buildPoseCatalogue, POSE_SAMPLE_SCHEMA, POSE_STATE_SCHEMA, type PoseBodyGender, type PoseCatalogueLoad, type PoseCatalogueState, type PoseSample, type PoseSet,
  type PoseTimings } from "./pose-catalogue";
export { POSE_SAMPLE_SCHEMA, POSE_STATE_SCHEMA, type PoseCatalogueLoad, type PoseCatalogueState, type PoseSample, type PoseTimings } from "./pose-catalogue";
import type { Installation, InstallationOptions } from "./resolver-host";
import { childId, TweakDbBlob, type TweakValue, tweakDbId } from "./tweakdb-flats";

const PUPPET_GENDERS = "Character.Player_Puppet_Photomode.genders";
const GENDER_RECORD: Record<PoseBodyGender, string> = { female: "Gender.Female", male: "Gender.Male" };
const INDEX_FILE = "set-index-1.json";
/** Decoded clips kept in memory (a clip is a few KB of keys; an animated one tens of KB). */
const CLIP_CACHE = 64;
export type PoseRoute = Omit<InstallationOptions, "cacheDir" | "log">;

const NEEDS_SETUP = "Poses come from your game. Choose your game folder in Game & tools.";
/** Asked for poses before the game folder is set up. */
export class PoseSetupError extends Error { constructor() { super(NEEDS_SETUP); } }
const PREPARING = "Reading your game's photo-mode poses…";
const FAILED = "XF Studio couldn't read your game's photo-mode poses. Try again, or check that the game folder is right in Game & tools.";

/** Cache identity of an archive: path, size and modification time. */
function archiveIdentity(archive: MountedArchive): string {
  try { const stat = statSync(archive.id); return `${archive.id}|${stat.size}|${stat.mtimeMs}`; } catch { return `${archive.id}|?`; }
}

/** The installation's compiled TweakDB, as the creator catalogue picks it. */
function tweakDbPath(gameRoot: string, ep1: boolean): { path: string; label: string } | null {
  const cache = join(gameRoot, "r6", "cache");
  const name = ep1 && existsSync(join(cache, "tweakdb_ep1.bin")) ? "tweakdb_ep1.bin" : "tweakdb.bin";
  return existsSync(join(cache, name)) ? { path: join(cache, name), label: `r6\\cache\\${name}` } : null;
}

type AnimDecoder = (request: NativeAnimRequest) => Promise<NativeAnimOutcome>;
const decoderOf = (installation: Installation): AnimDecoder | null => {
  const decoder = installation.fetcher.nativeDecoder;
  return decoder?.decodeAnim ? request => decoder.decodeAnim!(request) : null;
};

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => !!value && typeof value === "object" && !Array.isArray(value);
const cname = (value: unknown) => isObject(value) && typeof value.$value === "string" ? value.$value : typeof value === "string" ? value : "";
const depotOf = (value: unknown): { path: string | null; hash: string } | null => {
  const depot = isObject(value) ? value.DepotPath : null;
  if (!isObject(depot)) return null;
  const raw = String(depot.$value ?? "0");
  if (raw === "0") return null;
  return depot.$storage === "string" ? { path: raw, hash: depotHash(raw) } : { path: null, hash: raw };
};

/** The puppet entity's own sets: its `root` animated component and its animation-setup extension components, in component order. */
export function entitySets(entity: JsonObject): { path: string | null; hash: string; component: string; priority: number }[] {
  const out: { path: string | null; hash: string; component: string; priority: number }[] = [];
  const components = Array.isArray(entity.components) ? entity.components : [];
  for (const item of components) {
    const component = isObject(item) && isObject(item.Data) ? item.Data : item;
    if (!isObject(component)) continue;
    const type = String(component.$type ?? ""), name = cname(component.name);
    const extension = type === "entAnimationSetupExtensionComponent";
    if (!extension && !(type === "entAnimatedComponent" && name === "root")) continue;
    const setup = isObject(component.animations) ? component.animations : null;
    for (const entry of Array.isArray(setup?.gameplay) ? setup!.gameplay as unknown[] : []) {
      if (!isObject(entry)) continue;
      const ref = depotOf(entry.animSet);
      if (ref) out.push({ ...ref, component: name || type, priority: Number(entry.priority ?? 128) });
    }
  }
  return out;
}

/** Most set indexes kept on disk; past it the oldest go first (a changed archive leaves its old key behind). */
const MAX_INDEXED_SETS = 20_000;
/**
 * The on-disk index of sets' clip names, keyed by archive identity, set hash and decoder version: one per file per process, shared by
 * both body genders' builds, so neither drops the other's sets.
 */
class SetIndexCache {
  private entries = new Map<string, AnimSetIndex | { error: string }>();
  private dirty = false;
  constructor(private readonly file: string) {
    try { const read = JSON.parse(readFileSync(file, "utf8")); if (read?.version === ANIM_DECODER_VERSION) this.entries = new Map(Object.entries(read.entries)); } catch { /* start empty */ }
  }
  get(key: string) { return this.entries.get(key); }
  set(key: string, value: AnimSetIndex | { error: string }) { this.entries.delete(key); this.entries.set(key, value); this.dirty = true; }
  /** Write when anything changed, keeping at most `MAX_INDEXED_SETS` (the oldest dropped). */
  save() {
    for (const key of [...this.entries.keys()].slice(0, Math.max(0, this.entries.size - MAX_INDEXED_SETS))) { this.entries.delete(key); this.dirty = true; }
    if (!this.dirty) return;
    try { mkdirSync(join(this.file, ".."), { recursive: true }); writeFileAtomic(this.file, JSON.stringify({ version: ANIM_DECODER_VERSION, entries: Object.fromEntries(this.entries) })); this.dirty = false; }
    catch { /* Advisory: read again next time. */ }
  }
}

const setIndexes = new Map<string, SetIndexCache>();

/** Build one body gender's catalogue from an opened installation. */
export async function loadPoseCatalogue(installation: Installation, options: { gameRoot: string; cacheDir: string; bodyGender: PoseBodyGender; language?: string | null;
  log?: (message: string) => void; openMs?: number }): Promise<PoseCatalogueLoad> {
  const { gameRoot, cacheDir, bodyGender, log } = options;
  const started = performance.now();
  let mark = started;
  const lap = () => { const now = performance.now(), ms = now - mark; mark = now; return Math.round(ms); };

  const db = tweakDbPath(gameRoot, installation.plan.ep1Installed);
  const blob = db ? new TweakDbBlob(new Uint8Array(readFileSync(db.path))) : null;
  if (!blob) log?.("The game's TweakDB wasn't found, so no pose can be listed.");
  const memo = new Map<string, TweakValue | null>();
  const flats = (names: readonly string[]): Map<string, TweakValue> => {
    const missing = names.filter(name => !memo.has(name));
    if (missing.length && blob) {
      const ids = new Map(missing.map(name => [tweakDbId(name), name] as const));
      const found = blob.lookup(ids.keys());
      for (const name of missing) memo.set(name, null);
      for (const [id, value] of found) memo.set(ids.get(id)!, value);
    }
    const out = new Map<string, TweakValue>();
    for (const name of names) { const value = memo.get(name); if (value) out.set(name, value); }
    return out;
  };
  const tweakDbMs = lap();
  const overlay = installedTweakOverlay(installation, log);
  const providers = new Map((installation.tweaks ?? []).map(file => [file.virtualPath, file.providerName] as const));
  const overlayMs = lap();

  // The puppet entity for this body gender.
  let puppet: { hash: string; path: string | null } | null = null;
  if (blob) {
    const genders = blob.lookup([tweakDbId(PUPPET_GENDERS)]).get(tweakDbId(PUPPET_GENDERS));
    const wanted = tweakDbId(GENDER_RECORD[bodyGender]);
    const ids = genders?.type === "array:TweakDBID" ? genders.value : [];
    const fields = blob.lookup(ids.flatMap(id => [childId(id, ".gender"), childId(id, ".entity")]));
    for (const id of ids) {
      const gender = fields.get(childId(id, ".gender")), entity = fields.get(childId(id, ".entity"));
      if (gender?.type === "TweakDBID" && gender.value === wanted && entity?.type === "raRef:CResource") {
        puppet = { hash: entity.value, path: installation.xl.paths.get(entity.value) ?? null };
        break;
      }
    }
  }
  const graph = installation.graph;
  const sets: PoseSet[] = [];
  let puppetPath: string | null = null;
  let setTimings = { puppetMs: 0, setsMs: 0, setsRead: 0, setsCached: 0 };
  if (puppet) {
    const loaded = await graph.load(refFromHash(puppet.hash, puppet.path), "ent");
    puppetPath = loaded ? (loaded.provenance.ref.path ?? puppet.path ?? `#${puppet.hash}`) : null;
    const declared: { path: string; hash: string; from: PoseSet["from"]; priority: number }[] = [];
    if (loaded) for (const set of entitySets(loaded.root)) declared.push({ path: set.path ?? installation.xl.paths.get(set.hash) ?? `#${set.hash}`, hash: set.hash,
      from: { kind: "entity", component: set.component }, priority: set.priority });
    else log?.("The photo-mode puppet entity couldn't be read, so its own animation sets are unknown.");
    for (const entry of installation.xl.animations) {
      if (entry.component !== "root" || !entry.targets.has(puppet.hash)) continue;
      if (!graph.lookup(entry.setHash).winner) continue; // ArchiveXL skips a set the depot lacks.
      declared.push({ path: entry.set, hash: entry.setHash, from: { kind: "archivexl", declaredBy: entry.declaredBy }, priority: entry.priority });
    }
    const puppetMs0 = lap();
    // Each set's clip names, once per set (a set the puppet lists twice is looked up at its first place).
    const file = join(cacheDir, "poses", INDEX_FILE);
    let cache = setIndexes.get(file);
    if (!cache) { cache = new SetIndexCache(file); setIndexes.set(file, cache); }
    const decode = decoderOf(installation);
    let read = 0, cached = 0;
    const unique = [...new Map(declared.map(set => [set.hash, set] as const)).values()];
    const indexes = new Map<string, { index: AnimSetIndex | null; archive: MountedArchive | null }>();
    await Promise.all(unique.map(async set => {
      const archive = graph.lookup(set.hash).winner;
      if (!archive) { indexes.set(set.hash, { index: null, archive: null }); return; }
      const key = `${archiveIdentity(archive)}|${set.hash}`;
      const known = cache.get(key);
      if (known) { cached++; indexes.set(set.hash, { index: "error" in known ? null : known, archive }); return; }
      if (!decode) { indexes.set(set.hash, { index: null, archive }); return; }
      const outcome = await decode({ archivePath: archive.id, hash: set.hash, op: "index", priority: "background" });
      read++;
      if (outcome.ok && outcome.index) { cache.set(key, outcome.index); indexes.set(set.hash, { index: outcome.index, archive }); }
      else {
        const message = outcome.ok ? "no index" : `${outcome.kind}: ${outcome.message}`;
        // Lasting refusals are remembered for this archive version; ones that may pass are asked again next time.
        if (!outcome.ok && (outcome.kind === "malformed" || outcome.kind === "unsupported" || outcome.kind === "over-budget")) cache.set(key, { error: message });
        log?.(`Pose set ${set.path} (${archive.name}) couldn't be read: ${message}`);
        indexes.set(set.hash, { index: null, archive });
      }
    }));
    cache.save();
    const seen = new Set<string>();
    for (const set of declared) {
      if (seen.has(set.hash)) continue;
      seen.add(set.hash);
      const { index, archive } = indexes.get(set.hash) ?? { index: null, archive: null };
      sets.push({ path: set.path, hash: set.hash, archive: archive?.name ?? null, provider: archive?.providerName ?? null, from: set.from, priority: set.priority,
        clips: index ? new Map(index.clips.map(clip => [clip.name, { frames: clip.frames, duration: clip.duration, decodable: clip.buffer === "compressed",
          animatedKeys: clip.animatedKeys }] as const)) : null });
    }
    setTimings = { puppetMs: puppetMs0, setsMs: lap(), setsRead: read, setsCached: cached };
  } else { log?.("The photo-mode puppet for this body gender isn't in the game's TweakDB."); setTimings.puppetMs = lap(); }

  const language = options.language ?? currentGameLanguage() ?? "en-us";
  let text = await loadTextTable(installation, language, cacheDir, log);
  if (text.gameAbsent && language !== "en-us") text = await loadTextTable(installation, "en-us", cacheDir, log);
  const textsMs = lap();
  const catalogue = buildPoseCatalogue({ bodyGender, flats, overlay, providers, sets, text: text.table });
  const buildMs = lap();
  const timings: PoseTimings = { totalMs: Math.round(performance.now() - started + (options.openMs ?? 0)), openMs: Math.round(options.openMs ?? 0), tweakDbMs, overlayMs,
    ...setTimings, textsMs, buildMs };
  log?.(`Poses (${bodyGender}) listed in ${(timings.totalMs / 1000).toFixed(1)} s: ${catalogue.counts.listed} poses in ${catalogue.counts.categories} categories, ` +
    `${catalogue.counts.withClip} with a clip, ${catalogue.counts.sets} sets (${setTimings.setsRead} read, ${setTimings.setsCached} from the cache).`);
  return { catalogue, evidence: { tweakDb: db?.label ?? null, puppet: puppetPath, language: text.gameAbsent ? "en-us" : language, tweakFiles: overlay?.files ?? 0,
    overlayGaps: overlay?.gaps.length ?? 0, timings } };
}

export type PoseHostOptions = {
  /** The launch route (WolvenKit optional), or null while the game folder isn't set up. */
  route: () => PoseRoute | null;
  /** The installation fingerprint (character-detail-host.ts `installationFingerprint`). */
  fingerprint: () => string;
  resolverCache: string;
  open?: (options: InstallationOptions) => Installation | Promise<Installation>;
  language?: () => string | null;
  log?: (message: string) => void;
};
type Entry = { key: string; promise: Promise<{ load: PoseCatalogueLoad; installation: Installation }>; loaded: { load: PoseCatalogueLoad; installation: Installation } | null; error: string | null };

export class PoseCatalogueHost {
  private readonly entries = new Map<PoseBodyGender, Entry>();
  private readonly clips = new Map<string, AnimClip | null>();
  private readonly rigs = new Map<string, AnimRig | null>();
  constructor(private readonly options: PoseHostOptions) {}
  private key() { return `${this.options.fingerprint()}\n${(this.options.language ?? currentGameLanguage)() ?? ""}`; }

  /** The catalogue for a body gender, built once per installation and language; `force` builds again after a failure. */
  ensure(gender: PoseBodyGender, force = false): Promise<{ load: PoseCatalogueLoad; installation: Installation }> {
    const route = this.options.route();
    if (!route) return Promise.reject(new PoseSetupError());
    const key = this.key(), known = this.entries.get(gender);
    if (known && known.key === key && (!known.error || !force)) return known.promise;
    const entry: Entry = { key, promise: null as never, loaded: null, error: null };
    entry.promise = (async () => {
      const openStarted = performance.now();
      const open = this.options.open ?? (await import("./installation-registry")).acquireInstallation;
      const installation = await open({ ...route, cacheDir: this.options.resolverCache, log: this.options.log });
      const load = await loadPoseCatalogue(installation, { gameRoot: route.gameRoot, cacheDir: this.options.resolverCache, bodyGender: gender,
        language: this.options.language?.() ?? null, log: this.options.log, openMs: performance.now() - openStarted });
      entry.loaded = { load, installation };
      return entry.loaded;
    })();
    entry.promise.catch(error => { entry.error = (error as Error)?.message ?? String(error); this.options.log?.(`Poses were not read: ${(error as Error)?.stack ?? error}`); });
    this.entries.set(gender, entry);
    return entry.promise;
  }

  /** The state for a body gender, starting the first build when needed; never waits. */
  state(gender: PoseBodyGender): PoseCatalogueState {
    if (!this.options.route()) return { schema: POSE_STATE_SCHEMA, phase: "needs-setup", message: NEEDS_SETUP };
    const known = this.entries.get(gender);
    if (!known || known.key !== this.key()) this.ensure(gender).catch(() => {});
    const entry = this.entries.get(gender)!;
    if (entry.loaded) return { schema: POSE_STATE_SCHEMA, phase: "ready", message: "", catalogue: entry.loaded.load.catalogue, evidence: entry.loaded.load.evidence };
    if (entry.error) return { schema: POSE_STATE_SCHEMA, phase: "failed", message: FAILED };
    return { schema: POSE_STATE_SCHEMA, phase: "preparing", message: PREPARING };
  }

  /** Try again after a failure (answered as the state). */
  retry(gender: PoseBodyGender): PoseCatalogueState {
    if (this.entries.get(gender)?.error) this.ensure(gender, true).catch(() => {});
    return this.state(gender);
  }

  /** One pose's clip sampled at its time, with the rig's bone names; null when the pose, its clip or its rig can't be read. */
  async sample(gender: PoseBodyGender, id: string): Promise<PoseSample | null> {
    const { load, installation } = await this.ensure(gender);
    const entry = load.catalogue.entries.find(candidate => candidate.id === id);
    if (!entry?.clip?.decodable) return null;
    const decode = decoderOf(installation);
    const archive = installation.graph.lookup(entry.clip.setHash).winner;
    if (!decode || !archive) return null;
    const identity = archiveIdentity(archive);
    const clipKey = createHash("sha256").update(`${ANIM_DECODER_VERSION}|${identity}|${entry.clip.setHash}|${entry.clip.name}`).digest("hex");
    let clip = this.clips.get(clipKey);
    if (clip === undefined) {
      const outcome = await decode({ archivePath: archive.id, hash: entry.clip.setHash, op: "clip", clip: entry.clip.name });
      clip = outcome.ok ? outcome.clip ?? null : null;
      if (!outcome.ok) this.options.log?.(`Pose clip ${entry.clip.name} couldn't be decoded: ${outcome.kind}: ${outcome.message}`);
      if (outcome.ok || outcome.kind !== "unavailable") this.clips.set(clipKey, clip);
      for (const old of [...this.clips.keys()].slice(0, Math.max(0, this.clips.size - CLIP_CACHE))) this.clips.delete(old);
    }
    if (!clip) return null;
    // The set's rig names the clip's joints.
    const indexOutcome = await decode({ archivePath: archive.id, hash: entry.clip.setHash, op: "index" });
    const rigPath = indexOutcome.ok ? indexOutcome.index?.rig ?? null : null;
    if (!rigPath) return null;
    const rigHash = depotHash(rigPath);
    const rigArchive = installation.graph.lookup(rigHash).winner;
    if (!rigArchive) return null;
    const rigKey = `${archiveIdentity(rigArchive)}|${rigHash}`;
    let rig = this.rigs.get(rigKey);
    if (rig === undefined) {
      const outcome = await decode({ archivePath: rigArchive.id, hash: rigHash, op: "rig" });
      rig = outcome.ok ? outcome.rig ?? null : null;
      if (outcome.ok || outcome.kind !== "unavailable") this.rigs.set(rigKey, rig);
    }
    if (!rig) return null;
    const time = Math.min(Math.max(entry.time, 0), clip.duration);
    const sampled = sampleClip(clip, time);
    const joints = rig.bones.map((bone, index) => {
      const keyed = sampled.joints.get(index), reference = rig!.reference[index]!;
      return { bone, parent: rig!.parents[index]! >= 0 ? rig!.bones[rig!.parents[index]!]! : null,
        translation: [...(keyed?.translation ?? reference.translation)], rotation: [...(keyed?.rotation ?? reference.rotation)],
        scale: [...(keyed?.scale ?? reference.scale)], keyed: !!keyed };
    });
    const tracks: Record<string, number> = {};
    for (const [index, value] of sampled.tracks) tracks[rig.tracks[index] ?? `track${index}`] = value;
    return { schema: POSE_SAMPLE_SCHEMA, id, clip: { name: clip.name, set: entry.clip.set, frames: clip.frames, duration: clip.duration }, time, rig: rigPath, joints, tracks };
  }
}
